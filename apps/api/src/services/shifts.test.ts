import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { itemsRepo } = await import("../repositories/items.js");
const { usersRepo } = await import("../repositories/users.js");
const { createWalkInBill } = await import("./billing.js");
const { openShift, closeShift } = await import("./shifts.js");

itemsRepo.create({
  code: "OIL",
  name: "Engine Oil",
  price_wholesale: 350,
  price_retail: 399,
  purchase_value: 280,
  tax_percent: 18,
});
for (const id of ["cashier1", "cashier2", "cashier3", "cashier4"]) {
  usersRepo.create({ user_id: id, name: id, password_hash: "x", role: "operator" });
}

test("closeShift reconciles expected cash against cash sales made during the shift", () => {
  // Regression: the first draft compared shift.opened_at ("YYYY-MM-DD HH:MM:SS", SQLite's
  // datetime('now') format) against a JS `new Date().toISOString()` upper bound
  // ("YYYY-MM-DDTHH:MM:SS.sssZ") in a string BETWEEN — the differing separator character sorts
  // inconsistently and silently excludes same-day rows. Fixed in cashSalesSince() by using
  // SQLite's own datetime('now') for both sides of the comparison; this test pins that behavior.
  const shift = openShift("cashier1", 500);

  const bill = createWalkInBill({
    cashierId: "cashier1",
    paymentType: "cash",
    lines: [{ item_code: "OIL", qty: 2 }], // 399 * 2 = 798
  });

  const closed = closeShift(shift.id, 500 + bill.bill.grand_total);
  assert.equal(closed.expected_cash, 500 + bill.bill.grand_total);
  assert.equal(closed.variance, 0);
  assert.equal(closed.status, "closed");
});

test("closeShift reports a non-zero variance when counted cash doesn't match", () => {
  const shift = openShift("cashier2", 1000);
  const closed = closeShift(shift.id, 900);
  assert.equal(closed.expected_cash, 1000);
  assert.equal(closed.variance, -100);
});

test("openShift rejects a second open shift for the same user", () => {
  openShift("cashier3", 100);
  assert.throws(() => openShift("cashier3", 100), /already has an open shift/i);
});

test("closeShift rejects closing an already-closed shift", () => {
  const shift = openShift("cashier4", 100);
  closeShift(shift.id, 100);
  assert.throws(() => closeShift(shift.id, 100), /already closed/i);
});
