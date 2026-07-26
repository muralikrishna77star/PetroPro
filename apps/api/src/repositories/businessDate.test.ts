import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { stockRepo, todayDateOnly } = await import("./stock.js");
const { businessDateRepo } = await import("./businessDate.js");

// closeDay() only marks a date closed by writing a stock_daybook row per existing item, so at
// least one item must exist for it to have anything to close.
db.exec(`
  INSERT INTO groups (code, name) VALUES ('FUEL', 'Fuel');
  INSERT INTO items (code, name, group_code, price_wholesale, price_retail, purchase_value, tax_percent)
  VALUES ('MS', 'Petrol', 'FUEL', 90, 95, 85, 18);
`);

function daysAgo(n: number): string {
  return (db.prepare("SELECT date(?, '-' || ? || ' day') AS d").get(todayDateOnly(), n) as { d: string }).d;
}

test("get() starts equal to today on a fresh database", () => {
  assert.equal(businessDateRepo.get(), todayDateOnly());
});

test("get() self-heals forward across closed dates, but never past today", () => {
  const stale = daysAgo(2);
  db.prepare("UPDATE business_date SET running_date = ?").run(stale);
  stockRepo.closeDay(stale);

  // stale is closed, stale+1 is still open — get() should land there, not jump straight to today.
  const result = businessDateRepo.get();
  assert.equal(result, daysAgo(1));
  assert.equal(stockRepo.isDateClosed(result), false);
});

test("advance() moves the running date forward by one day, capped at today", () => {
  db.prepare("UPDATE business_date SET running_date = ?").run(daysAgo(1));
  const next = businessDateRepo.advance();
  assert.equal(next, todayDateOnly());

  // Already at today — advancing again must not push it into the future.
  const stillToday = businessDateRepo.advance();
  assert.equal(stillToday, todayDateOnly());
});
