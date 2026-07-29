#!/usr/bin/env node
// Desktop launcher — matches WareCore's approach (scripts/desktop/start.mjs there): start the
// app's own servers locally, then open a chromeless Chrome/Edge/Brave window pointed at the web
// server (`--app --kiosk`), so it reads and behaves like a native app with no browser chrome, no
// separate install, and no Electron/Tauri runtime. Falls back to the OS default browser if no
// Chromium-based browser is found on the machine.
//
// Unlike WareCore (which bundles an embedded Postgres), PetroPro's SQLite database is just a
// file — there's no database *server* to start here, only the API (Fastify) and web (Next.js
// standalone) processes.
//
// Works both run in-place from the dev repo (after `npm run build`) and from a staged portable
// copy produced by installer/stage.mjs — both lay out apps/api/dist and
// apps/web/.next/standalone in the same relative positions under the repo root.

import { spawn, exec } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const API_PORT = Number(process.env.API_PORT ?? 4000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const CONTROL_PORT = Number(process.env.DESKTOP_CONTROL_PORT ?? 4098);
const NO_BROWSER = process.argv.includes("--no-browser");

const apiDir = path.join(repoRoot, "apps", "api");
const apiEntry = path.join(apiDir, "dist", "index.js");
const webDir = path.join(repoRoot, "apps", "web");
const webStandaloneDir = path.join(webDir, ".next", "standalone", "apps", "web");
const webServerEntry = path.join(webStandaloneDir, "server.js");
const dataDir = path.join(apiDir, "data");
const jwtSecretFile = path.join(dataDir, ".desktop-jwt-secret");

function log(msg) {
  console.log(`[petropro-desktop] ${msg}`);
}

function requireBuilt() {
  const missing = [];
  if (!fs.existsSync(apiEntry)) missing.push(apiEntry);
  if (!fs.existsSync(webServerEntry)) missing.push(webServerEntry);
  if (missing.length > 0) {
    console.error("[petropro-desktop] Build output not found:\n" + missing.map((m) => `  - ${m}`).join("\n"));
    console.error('[petropro-desktop] Run "npm run build" first.');
    process.exit(1);
  }
}

/** `next build`'s standalone output deliberately excludes .next/static and public/ (traced only
 *  what server-side code needs) — the server expects both to sit next to server.js at runtime
 *  (server.js does `process.chdir(__dirname)`). Re-copied on every launch so a rebuild is always
 *  reflected, rather than only wiring this into the build step itself. */
function ensureStaticAssetsCopied() {
  fs.cpSync(path.join(webDir, ".next", "static"), path.join(webStandaloneDir, ".next", "static"), {
    recursive: true,
  });
  if (fs.existsSync(path.join(webDir, "public"))) {
    fs.cpSync(path.join(webDir, "public"), path.join(webStandaloneDir, "public"), { recursive: true });
  }
}

/** A stable per-install JWT secret so restarting the app doesn't invalidate every open session —
 *  generated once and persisted alongside the database, never the hardcoded dev default. */
function loadOrCreateJwtSecret() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(jwtSecretFile)) {
    return fs.readFileSync(jwtSecretFile, "utf8").trim();
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(jwtSecretFile, secret, { mode: 0o600 });
  return secret;
}

function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (async function poll() {
      while (Date.now() < deadline) {
        try {
          const res = await fetch(url);
          if (res.ok || res.status < 500) return resolve();
        } catch {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      reject(new Error(`Timed out waiting for ${url}`));
    })();
  });
}

const CHROMIUM_CANDIDATES = [
  "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
  "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
  "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe",
  "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
  "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
  "%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  "%ProgramFiles(x86)%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
];

function findChromiumBrowser() {
  for (const template of CHROMIUM_CANDIDATES) {
    const resolved = template.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? "");
    if (resolved.includes("%")) continue; // an env var in the template wasn't set
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function openKioskWindow(url) {
  const browser = findChromiumBrowser();
  if (!browser) {
    log("No Chrome/Edge/Brave install found — opening in the default browser instead.");
    exec(`start "" "${url}"`);
    return;
  }
  const profileDir = path.join(dataDir, "browser-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  log(`Opening kiosk window via ${browser}`);
  spawn(
    browser,
    [`--app=${url}`, "--kiosk", `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check"],
    { detached: true, stdio: "ignore" },
  ).unref();
}

function startControlServer(children) {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/shutdown") {
      res.writeHead(200).end("ok");
      log("Shutdown requested — stopping servers.");
      for (const child of children) child.kill();
      server.close();
      setTimeout(() => process.exit(0), 200);
      return;
    }
    res.writeHead(404).end();
  });
  // 127.0.0.1 only — this is a same-machine control channel, not something to expose on the LAN.
  server.listen(CONTROL_PORT, "127.0.0.1");
  return server;
}

async function main() {
  requireBuilt();
  ensureStaticAssetsCopied();
  const jwtSecret = loadOrCreateJwtSecret();
  const children = [];

  const api = spawn(process.execPath, [apiEntry], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DB_PATH: path.join(dataDir, "petropro.db"),
      JWT_SECRET: jwtSecret,
    },
    stdio: "inherit",
  });
  children.push(api);

  const web = spawn(process.execPath, [webServerEntry], {
    env: { ...process.env, PORT: String(WEB_PORT), HOSTNAME: "127.0.0.1" },
    stdio: "inherit",
  });
  children.push(web);

  const shutdown = () => {
    for (const child of children) child.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log("Waiting for the API and web server to come up...");
  await Promise.all([
    waitForHealth(`http://127.0.0.1:${API_PORT}/health`, 30_000),
    waitForHealth(`http://127.0.0.1:${WEB_PORT}/login`, 30_000),
  ]);
  log(`Ready — API on ${API_PORT}, web on ${WEB_PORT}.`);

  startControlServer(children);

  if (!NO_BROWSER) {
    openKioskWindow(`http://127.0.0.1:${WEB_PORT}/login?desktop=1`);
  }
}

main().catch((err) => {
  console.error("[petropro-desktop] Failed to start:", err);
  process.exit(1);
});
