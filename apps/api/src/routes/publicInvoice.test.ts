import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const { communicationSettingsRepo } = await import("../repositories/communicationSettings.js");
const { communicationLogRepo } = await import("../repositories/communicationLog.js");

db.prepare("INSERT INTO bills (bill_no, grand_total, sub_total) VALUES (1, 250, 250), (2, 99, 99)").run();

const app = await buildApp();
app.log.level = "silent";
test.after(() => app.close());
const t = app.jwt.sign({ sub: "1", role: "invoice" }, { expiresIn: "30m" });
const send = (mobile: string, token = t, billNo = 1) =>
  app.inject({
    method: "POST",
    url: `/public/invoice/${billNo}/whatsapp?t=${token}`,
    payload: { mobile_number: mobile },
  });

test("QR WhatsApp option is off by default and reported to the scanned page", async () => {
  const res = await app.inject({ method: "GET", url: `/public/invoice/1?t=${t}` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().whatsapp, { enabled: false, default_country_code: "91", link_days: 7 });
  assert.equal((await send("9876543210")).statusCode, 403);
});

test("once enabled, the customer's own number gets a wa.me link with a long-lived bill link", async () => {
  communicationSettingsRepo.update({ qr_whatsapp_enabled: true, qr_whatsapp_link_days: 10 });
  const res = await send("98765 43210");
  assert.equal(res.statusCode, 200);
  const { whatsappUrl, expiresInDays } = res.json();
  assert.equal(expiresInDays, 10);
  assert.match(whatsappUrl, /^https:\/\/wa\.me\/919876543210\?text=/);

  const text = decodeURIComponent(whatsappUrl.split("?text=")[1]);
  const longToken = text.match(/\/i\/1\?t=([^\s]+)/)![1];
  const payload = app.jwt.verify<{ sub: string; role: string; exp: number; iat: number }>(longToken);
  assert.equal(payload.sub, "1");
  assert.equal(payload.role, "invoice");
  assert.equal(payload.exp - payload.iat, 10 * 86400);

  const log = communicationLogRepo.listByBill(1)[0];
  assert.equal(log.mobile_number, "919876543210");
  assert.equal(log.channel, "whatsapp");
});

test("rejects bad numbers, and tokens for another bill", async () => {
  assert.equal((await send("12345")).statusCode, 400);
  assert.equal((await send("9876543210", t, 2)).statusCode, 401);
});

test("link validity outside 1-90 days is refused", () => {
  assert.throws(() => communicationSettingsRepo.update({ qr_whatsapp_link_days: 0 }), /between 1 and 90/);
  assert.throws(() => communicationSettingsRepo.update({ qr_whatsapp_link_days: 365 }), /between 1 and 90/);
  assert.equal(communicationSettingsRepo.get().qr_whatsapp_link_days, 10);
});
