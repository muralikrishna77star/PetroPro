import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { rateChangesRepo } = await import("./rateChanges.js");

db.exec(`
  INSERT INTO groups (code, name) VALUES ('FUEL', 'Fuel');
  INSERT INTO items (code, name, group_code, price_wholesale, price_retail, purchase_value, tax_percent)
  VALUES ('MS', 'Petrol', 'FUEL', 90, 95, 85, 18);
`);

test("remove() retracts a pending rate change", () => {
  const created = rateChangesRepo.create({ item_code: "MS", rate: 100, scheduled_on: "2026-08-01" });
  const removed = rateChangesRepo.remove(created.id);
  assert.equal(removed, true);
  assert.equal(rateChangesRepo.get(created.id), undefined);
});

test("remove() refuses to delete an already-applied change", () => {
  const created = rateChangesRepo.create({ item_code: "MS", rate: 101, scheduled_on: "2026-08-02" });
  rateChangesRepo.markApplied(created.id);
  const removed = rateChangesRepo.remove(created.id);
  assert.equal(removed, false);
  assert.ok(rateChangesRepo.get(created.id));
});
