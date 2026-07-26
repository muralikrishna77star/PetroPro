import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { stockRepo } = await import("./stock.js");

db.exec(`
  INSERT INTO groups (code, name) VALUES ('FUEL', 'Fuel');
  INSERT INTO items (code, name, group_code, price_wholesale, price_retail, purchase_value, tax_percent)
  VALUES ('MS', 'Petrol', 'FUEL', 90, 95, 85, 18);
`);

test("closeDay blocks further sales, receipts and reversals against that date", () => {
  const date = "2026-01-15";
  stockRepo.applySale("MS", 5, date);
  assert.equal(stockRepo.isDateClosed(date), false);

  stockRepo.closeDay(date);
  assert.equal(stockRepo.isDateClosed(date), true);

  assert.throws(() => stockRepo.applySale("MS", 1, date), /closed/i);
  assert.throws(() => stockRepo.applyReceipt("MS", 1, date), /closed/i);
  assert.throws(() => stockRepo.reverseSale("MS", 1, date), /closed/i);

  // Closed date rejected the write — sales bucket unchanged from before the attempt.
  assert.equal(stockRepo.getRow("MS", date)?.sales, 5);
});

test("closeDay closes a date even when no item has transacted on it yet", () => {
  const date = "2026-01-16";
  stockRepo.closeDay(date); // no rows exist for this date yet in the raw table
  assert.equal(stockRepo.isDateClosed(date), true);
  assert.throws(() => stockRepo.applySale("MS", 1, date), /closed/i);
  assert.throws(() => stockRepo.applyReceipt("MS", 1, date), /closed/i);
});

test("an open date still accepts sales and receipts", () => {
  const date = "2026-01-17";
  stockRepo.applyReceipt("MS", 10, date);
  stockRepo.applySale("MS", 4, date);
  const row = stockRepo.getRow("MS", date);
  assert.equal(row?.receipts, 10);
  assert.equal(row?.sales, 4);
});
