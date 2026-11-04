#!/usr/bin/env node
// PetroPro print bridge. A browser can't open a raw connection to a printer, and the API runs in the
// cloud where it can't see the station's network, so this small program runs on the billing computer
// and passes receipts on. It has no dependencies. See docs/THERMAL_PRINTING.md for setup.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = "1.0.0";
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 5000;
const STATUS_TIMEOUT_MS = 500;
const SENT_MEMORY_MS = 10 * 60 * 1000;
const DLE_EOT_PAPER = Buffer.from([0x10, 0x04, 0x04]);

/** Only private addresses: this is the billing computer's own network, and a stolen pairing token
 *  mustn't turn the bridge into a way of reaching anything else. */
export function isPrivateAddress(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
}

function describeNetworkError(err, label) {
  if (err.code === "ECONNREFUSED") return `${label} refused the connection. Is it switched on?`;
  if (err.code === "ETIMEDOUT" || err.code === "EHOSTUNREACH" || err.code === "ENETUNREACH") return `Can't reach ${label}. Check its cable and address.`;
  if (err.code === "ENOTFOUND") return `Can't find ${label}. Check its address.`;
  return `${label} failed: ${err.message}`;
}

/** Sends to a LAN printer, port 9100 style. Most printers answer a paper-sensor query, which catches
 *  an empty roll before the receipt is lost. One that doesn't answer simply gets the receipt. */
export function sendTcp(host, port, data) {
  const label = `Printer ${host}:${port}`;
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    let written = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    const connectTimer = setTimeout(() => done(new Error(`Can't reach ${label}. Check its cable and address.`)), CONNECT_TIMEOUT_MS);
    const write = () => {
      if (written || settled) return;
      written = true;
      socket.end(data);
    };
    socket.on("connect", () => {
      clearTimeout(connectTimer);
      socket.write(DLE_EOT_PAPER);
      setTimeout(write, STATUS_TIMEOUT_MS);
    });
    socket.on("data", (reply) => {
      if (!written && reply.length > 0 && (reply[0] & 0x60) === 0x60) done(new Error(`${label} is out of paper`));
    });
    socket.on("error", (err) => {
      clearTimeout(connectTimer);
      done(new Error(describeNetworkError(err, label)));
    });
    socket.on("close", () => {
      clearTimeout(connectTimer);
      if (written) done();
      else done(new Error(`${label} closed the connection before printing`));
    });
  });
}

function sendWindows(printer, data) {
  const file = path.join(os.tmpdir(), `petropro-${crypto.randomUUID()}.bin`);
  fs.writeFileSync(file, data);
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "windows-raw-print.ps1"), "-Printer", printer, "-File", file],
      { timeout: 30000 },
      (err, _stdout, stderr) => {
        fs.rmSync(file, { force: true });
        if (err) reject(new Error(`Windows couldn't print to "${printer}": ${(stderr || err.message).trim().slice(0, 200)}`));
        else resolve();
      },
    );
  });
}

function listWindowsPrinters() {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"],
      { timeout: 15000 },
      (err, stdout) => resolve(err ? [] : stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)),
    );
  });
}

function json(res, status, body, headers) {
  res.writeHead(status, { ...headers, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sameToken(given, expected) {
  const a = crypto.createHash("sha256").update(String(given ?? "")).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Three checks stand between a web page and the printer. The Host header stops DNS rebinding, the
 * Origin must be a PetroPro site this bridge was told about, and the token proves this browser was
 * paired by someone at this computer. It listens on loopback only.
 */
export function createBridge({ token, origins, allowedPorts = [9100, 9101, 9102, 9103], senders = {} }) {
  const tcp = senders.tcp ?? sendTcp;
  const windows = senders.windows ?? sendWindows;
  const device = senders.device ?? ((p, data) => fs.promises.writeFile(p, data));
  const lookup = senders.lookup ?? (async (host) => (net.isIP(host) ? host : (await dns.lookup(host, { family: 4 })).address));
  const printers = senders.listPrinters ?? listWindowsPrinters;
  const sent = new Map();
  let queue = Promise.resolve();

  function rememberSent(key) {
    const now = Date.now();
    for (const [k, at] of sent) if (now - at > SENT_MEMORY_MS) sent.delete(k);
    sent.set(key, now);
  }

  async function deliver(target, data) {
    if (target?.type === "lan") {
      const port = Number(target.port);
      if (!allowedPorts.includes(port)) throw Object.assign(new Error(`Port ${port} isn't allowed. The bridge allows ${allowedPorts.join(", ")}.`), { status: 400 });
      let address;
      try {
        address = await lookup(String(target.host ?? ""));
      } catch (err) {
        throw new Error(describeNetworkError(err, `Printer ${target.host}`));
      }
      if (!isPrivateAddress(address)) throw Object.assign(new Error("The printer's address must be on the local network"), { status: 400 });
      return tcp(address, port, data);
    }
    if (target?.type === "usb" && typeof target.printer === "string" && target.printer) {
      if (/^\/dev\/(usb\/)?lp\d+$/.test(target.printer)) return device(target.printer, data);
      if (process.platform === "win32" || senders.windows) return windows(target.printer, data);
      throw Object.assign(new Error("On this computer, use a device path such as /dev/usb/lp0"), { status: 400 });
    }
    throw Object.assign(new Error("No printer was named"), { status: 400 });
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origins.includes(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Token",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          // Chrome asks this before a public site may call a local address.
          "Access-Control-Allow-Private-Network": "true",
          Vary: "Origin",
        }
      : { Vary: "Origin" };

    const hostname = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (hostname !== "127.0.0.1" && hostname !== "localhost") return json(res, 403, { error: "Wrong host" }, {});
    if (origin !== undefined && !origins.includes(origin)) return json(res, 403, { error: `This bridge doesn't accept ${origin}` }, cors);
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }

    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, version: VERSION }, cors);
    if (!sameToken(req.headers["x-bridge-token"], token)) return json(res, 401, { error: "The pairing token is wrong" }, cors);

    if (req.method === "GET" && url.pathname === "/printers") return json(res, 200, { printers: await printers() }, cors);

    if (req.method === "POST" && url.pathname === "/print") {
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString("utf8"));
      } catch (err) {
        return json(res, err.message === "too large" ? 413 : 400, { error: "That request couldn't be read" }, cors);
      }
      const data = Buffer.from(String(body.data_base64 ?? ""), "base64");
      if (data.length === 0) return json(res, 400, { error: "There's nothing to print" }, cors);
      const key = typeof body.job_key === "string" ? body.job_key : null;
      // The reply can be lost after the paper came out. Sending it again must not print it twice.
      if (key && sent.has(key)) return json(res, 200, { ok: true, already_sent: true }, cors);

      // One at a time, so two receipts can't interleave on the paper.
      const attempt = queue.then(() => deliver(body.target, data));
      queue = attempt.catch(() => undefined);
      try {
        await attempt;
        if (key) rememberSent(key);
        return json(res, 200, { ok: true }, cors);
      } catch (err) {
        return json(res, err.status ?? 502, { error: err.message }, cors);
      }
    }
    return json(res, 404, { error: "Not found" }, cors);
  });
}

function configPath() {
  const base = process.env.PETROPRO_BRIDGE_HOME ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), ".config"), "PetroProBridge");
  return path.join(base, "config.json");
}

/** The token is created on this computer on first run, and kept only here and in the paired browser. */
function loadConfig() {
  const file = configPath();
  if (fs.existsSync(file)) return { file, config: JSON.parse(fs.readFileSync(file, "utf8")) };
  const config = {
    port: 9147,
    token: crypto.randomBytes(24).toString("base64url"),
    origins: ["https://petropro-demo.vercel.app", "http://localhost:3000"],
    allowedPorts: [9100, 9101, 9102, 9103],
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  return { file, config };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { file, config } = loadConfig();
  createBridge(config).listen(config.port, "127.0.0.1", () => {
    console.log(`PetroPro print bridge ${VERSION} is running at http://127.0.0.1:${config.port}`);
    console.log(`Settings: ${file}`);
    console.log(`Accepting: ${config.origins.join(", ")}`);
    console.log(`Pairing token, for Printer Settings in PetroPro: ${config.token}`);
  });
}
