import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { itemsRepo } = await import("../repositories/items.js");
const { stockRepo } = await import("../repositories/stock.js");
const { recordPurchase } = await import("./purchasing.js");

itemsRepo.create({
  code: "OIL",
  name: "Engine Oil",
  price_wholesale: 350,
  price_retail: 399,
  purchase_value: 280,
  tax_percent: 18,
});

test("recordPurchase feeds the stock day-book's receipts bucket", () => {
  const result = recordPurchase({ item_code: "OIL", qty: 10, value: 2800, pur_date: "2026-02-01" });
  assert.equal(result.item_code, "OIL");
  assert.equal(stockRepo.getRow("OIL", "2026-02-01")?.receipts, 10);
});

test("recordPurchase refuses to post against a closed stock day, and records no purchase", () => {
  stockRepo.closeDay("2026-02-02");
  const before = db.prepare("SELECT COUNT(*) AS n FROM purchases").get() as { n: number };

  assert.throws(
    () => recordPurchase({ item_code: "OIL", qty: 5, value: 1400, pur_date: "2026-02-02" }),
    /closed/i,
  );

  const after = db.prepare("SELECT COUNT(*) AS n FROM purchases").get() as { n: number };
  assert.equal(after.n, before.n);
});
