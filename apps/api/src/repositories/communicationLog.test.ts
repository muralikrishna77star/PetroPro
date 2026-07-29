import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { itemsRepo } = await import("./items.js");
const { usersRepo } = await import("./users.js");
const { createWalkInBill } = await import("../services/billing.js");
const { communicationLogRepo } = await import("./communicationLog.js");

itemsRepo.create({
  code: "OIL",
  name: "Engine Oil",
  price_wholesale: 350,
  price_retail: 399,
  purchase_value: 280,
  tax_percent: 18,
});
usersRepo.create({ user_id: "cashier1", name: "Cashier", password_hash: "x", role: "operator" });

const { bill } = createWalkInBill({ cashierId: "cashier1", paymentType: "cash", lines: [{ item_code: "OIL", qty: 1 }] });

test("record() persists a send attempt and returns the created row", () => {
  const entry = communicationLogRepo.record({
    bill_no: bill.bill_no,
    mobile_number: "919876543210",
    channel: "whatsapp",
    status: "sent",
    remarks: "WhatsApp Web opened",
  });
  assert.equal(entry.bill_no, bill.bill_no);
  assert.equal(entry.channel, "whatsapp");
  assert.equal(entry.status, "sent");
  assert.ok(entry.id > 0);
});

test("listByBill() returns only entries for that bill, newest first", () => {
  communicationLogRepo.record({ bill_no: bill.bill_no, channel: "share_pdf", status: "failed", remarks: "popup blocked" });
  const entries = communicationLogRepo.listByBill(bill.bill_no);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.channel, "share_pdf");
  assert.ok(entries.every((e) => e.bill_no === bill.bill_no));
});

test("list() returns recent entries across all bills, capped by limit", () => {
  const entries = communicationLogRepo.list(1);
  assert.equal(entries.length, 1);
});
