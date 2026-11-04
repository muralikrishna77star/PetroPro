import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createBridge, isPrivateAddress, sendTcp } from "./bridge.mjs";

const TOKEN = "test-token-123456";
const ORIGIN = "https://petropro.example";
const DATA = Buffer.from([0x1b, 0x40, 0x41, 0x42, 0x0a]);

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

/** A stand-in for a LAN printer: it collects what it receives, and answers the paper query if told to. */
async function fakePrinter({ paperReply } = {}) {
  const received = [];
  const server = net.createServer((socket) => {
    const chunks = [];
    socket.on("data", (d) => {
      if (d[0] === 0x10 && d[1] === 0x04) {
        if (paperReply !== undefined) socket.write(Buffer.from([paperReply]));
        if (d.length > 3) chunks.push(d.subarray(3));
      } else chunks.push(d);
    });
    socket.on("end", () => {
      received.push(Buffer.concat(chunks));
      socket.end();
    });
    socket.on("error", () => undefined);
  });
  const port = await listen(server);
  return { port, received, close: () => new Promise((r) => server.close(r)) };
}

async function bridge(options = {}, t) {
  const server = createBridge({ token: TOKEN, origins: [ORIGIN], ...options });
  const port = await listen(server);
  t.after(() => new Promise((r) => server.close(r)));
  return {
    port,
    call(path, { method = "GET", body, token = TOKEN, origin = ORIGIN, host } = {}) {
      return request(port, path, { method, body, token, origin, host });
    },
  };
}

/** Raw http so a test can send a Host header, which fetch refuses to change. */
async function request(port, path, { method, body, token, origin, host }) {
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-Bridge-Token"] = token;
    if (origin) headers.Origin = origin;
    if (host) headers.Host = host;
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const printBody = (port, extra = {}) => ({
  job_key: `job-${Math.random()}`,
  data_base64: DATA.toString("base64"),
  target: { type: "lan", host: "127.0.0.1", port },
  ...extra,
});

test("only private addresses count as the local network", () => {
  for (const ok of ["192.168.1.50", "10.0.0.9", "172.16.0.1", "172.31.255.1", "127.0.0.1"]) assert.equal(isPrivateAddress(ok), true, ok);
  for (const bad of ["8.8.8.8", "172.32.0.1", "169.254.169.254", "192.169.1.1", "printer.local", "1.2.3", "::1"]) assert.equal(isPrivateAddress(bad), false, bad);
});

test("a page needs the right site, the right host and the right token", async (t) => {
  const b = await bridge({}, t);
  assert.equal((await b.call("/health", { token: null })).status, 200);
  assert.equal((await b.call("/printers", { token: null })).status, 401);
  assert.equal((await b.call("/printers", { token: "wrong" })).status, 401);
  assert.equal((await b.call("/health", { origin: "https://evil.example" })).status, 403);
  assert.equal((await b.call("/health", { host: "evil.example:9147" })).status, 403);
  const printed = await b.call("/print", { method: "POST", token: "wrong", body: printBody(9100) });
  assert.equal(printed.status, 401);
});

test("Chrome's preflight for a local address is answered, for the allowed site only", async (t) => {
  const b = await bridge({}, t);
  const ok = await b.call("/print", { method: "OPTIONS", token: null });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers["access-control-allow-private-network"], "true");
  assert.equal(ok.headers["access-control-allow-origin"], ORIGIN);
  const bad = await b.call("/print", { method: "OPTIONS", token: null, origin: "https://evil.example" });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers["access-control-allow-origin"], undefined);
});

test("a receipt reaches a LAN printer byte for byte", async (t) => {
  const printer = await fakePrinter();
  t.after(printer.close);
  const b = await bridge({ allowedPorts: [printer.port] }, t);
  const res = await b.call("/print", { method: "POST", body: printBody(printer.port) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(printer.received, [DATA]);
});

test("sending the same job again doesn't print it again", async (t) => {
  const printer = await fakePrinter();
  t.after(printer.close);
  const b = await bridge({ allowedPorts: [printer.port] }, t);
  const body = printBody(printer.port, { job_key: "job-7-1" });
  await b.call("/print", { method: "POST", body });
  const again = await b.call("/print", { method: "POST", body });
  assert.equal(again.status, 200);
  assert.equal(again.body.already_sent, true);
  assert.equal(printer.received.length, 1);
});

test("a printer that's off fails clearly, and printing works again once it's back", async (t) => {
  const printer = await fakePrinter();
  const { port } = printer;
  await printer.close();
  const b = await bridge({ allowedPorts: [port] }, t);
  const body = printBody(port, { job_key: "job-9-1" });
  const failed = await b.call("/print", { method: "POST", body });
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /refused/);

  const server = net.createServer((socket) => {
    socket.on("data", () => undefined);
    socket.on("end", () => socket.end());
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => new Promise((r) => server.close(r)));
  const recovered = await b.call("/print", { method: "POST", body });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal(recovered.body.already_sent, undefined);
});

test("an empty roll stops the job before the receipt is lost", async (t) => {
  const printer = await fakePrinter({ paperReply: 0x72 });
  t.after(printer.close);
  await assert.rejects(sendTcp("127.0.0.1", printer.port, DATA), /out of paper/);
});

test("a printer reporting paper present gets the receipt", async (t) => {
  const printer = await fakePrinter({ paperReply: 0x12 });
  t.after(printer.close);
  await sendTcp("127.0.0.1", printer.port, DATA);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(printer.received, [DATA]);
});

test("it can't be pointed at the internet or at other services", async (t) => {
  const calls = [];
  const b = await bridge({ senders: { tcp: async (h, p) => calls.push([h, p]), lookup: async () => "93.184.216.34" } }, t);
  const publicHost = await b.call("/print", { method: "POST", body: { ...printBody(9100), target: { type: "lan", host: "example.com", port: 9100 } } });
  assert.equal(publicHost.status, 400);
  const b2 = await bridge({ senders: { tcp: async (h, p) => calls.push([h, p]) } }, t);
  const wrongPort = await b2.call("/print", { method: "POST", body: { ...printBody(22), target: { type: "lan", host: "192.168.1.5", port: 22 } } });
  assert.equal(wrongPort.status, 400);
  assert.deepEqual(calls, []);
});

test("USB goes to the named Windows printer or device path, never another file", async (t) => {
  const windows = [];
  const devices = [];
  const b = await bridge(
    { senders: { windows: async (name) => windows.push(name), device: async (p) => devices.push(p), listPrinters: async () => ["TM-T82"] } },
    t,
  );
  assert.deepEqual((await b.call("/printers")).body.printers, ["TM-T82"]);
  await b.call("/print", { method: "POST", body: printBody(0, { target: { type: "usb", printer: "TM-T82" } }) });
  await b.call("/print", { method: "POST", body: printBody(0, { target: { type: "usb", printer: "/dev/usb/lp0" } }) });
  await b.call("/print", { method: "POST", body: printBody(0, { target: { type: "usb", printer: "/etc/passwd" } }) });
  assert.deepEqual(devices, ["/dev/usb/lp0"]);
  assert.deepEqual(windows, ["TM-T82", "/etc/passwd"]); // handed to Windows as a printer name, which it isn't
});

test("nothing to print, an unnamed printer and an oversized body are refused", async (t) => {
  const b = await bridge({ senders: { tcp: async () => undefined } }, t);
  assert.equal((await b.call("/print", { method: "POST", body: { target: { type: "lan", host: "192.168.1.5", port: 9100 } } })).status, 400);
  assert.equal((await b.call("/print", { method: "POST", body: { data_base64: "QQ==" } })).status, 400);
});

test("two jobs at once don't interleave", async (t) => {
  const order = [];
  let running = 0;
  const b = await bridge(
    {
      senders: {
        tcp: async (_h, _p, data) => {
          running++;
          assert.equal(running, 1, "one at a time");
          order.push(data.toString());
          await new Promise((r) => setTimeout(r, 30));
          running--;
        },
      },
    },
    t,
  );
  const one = (text) => ({ job_key: text, data_base64: Buffer.from(text).toString("base64"), target: { type: "lan", host: "192.168.1.5", port: 9100 } });
  const results = await Promise.all([b.call("/print", { method: "POST", body: one("first") }), b.call("/print", { method: "POST", body: one("second") })]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(order.length, 2);
});
