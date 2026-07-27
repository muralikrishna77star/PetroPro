import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// resetTransactionalData() calls createBackup(), which needs a real file (VACUUM INTO) rather
// than ":memory:" — see backup.test.ts for why.
const testDbPath = path.join(os.tmpdir(), `petropro-datareset-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = testDbPath;

const dbClient = await import("../db/client.js");
const { itemsRepo } = await import("../repositories/items.js");
const { usersRepo } = await import("../repositories/users.js");
const { customersRepo } = await import("../repositories/customers.js");
const { createWalkInBill } = await import("./billing.js");
const { pendingTransactionsRepo } = await import("../repositories/pendingTransactions.js");
const { ordersRepo } = await import("../repositories/orders.js");
const { resetTransactionalData } = await import("./dataReset.js");

test.after(() => {
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // best-effort cleanup
  }
  try {
    fs.rmSync(path.join(path.dirname(testDbPath), "backups"), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

itemsRepo.create({
  code: "OIL",
  name: "Engine Oil",
  price_wholesale: 350,
  price_retail: 399,
  purchase_value: 280,
  tax_percent: 18,
  track_mileage: true,
});
usersRepo.create({ user_id: "cashier1", name: "Cashier", password_hash: "x", role: "operator" });
usersRepo.create({ user_id: "attendant1", name: "Attendant", password_hash: "x", role: "field_operator" });
customersRepo.create({ code: "CUST1", name: "Test Customer" } as never);

test("resetTransactionalData clears every transactional table without tripping a foreign key", () => {
  // Seed a row in every table that references bills/orders — a wrong delete order (bills before
  // its dependents) trips a FOREIGN KEY constraint, which is the exact bug this test guards.
  createWalkInBill({
    cashierId: "cashier1",
    paymentType: "cash",
    vehicleNo: "KA01AB1234",
    lines: [{ item_code: "OIL", qty: 1, odometer: 1000 }],
  });
  pendingTransactionsRepo.create({ vehicle_no: "KA02CD5678", item_code: "OIL", qty: 1, attendant_id: "attendant1" });
  const order = ordersRepo.create({
    customerCode: "CUST1",
    lines: [{ item_code: "OIL", qty_ordered: 5, rate_at_order: 399 }],
  });
  ordersRepo.applyFulfillment(order.lines[0].id, 1);

  assert.doesNotThrow(() => resetTransactionalData());

  const count = (table: string) =>
    (dbClient.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  for (const table of [
    "bill_lines",
    "bills",
    "pending_transactions",
    "mileage_log",
    "order_lines",
    "orders",
    "stock_daybook",
    "purchases",
    "receipts",
    "audit_logs",
    "shifts",
    "opening_balances",
  ]) {
    assert.equal(count(table), 0, `${table} should be empty after reset`);
  }
  assert.equal(customersRepo.get("CUST1")?.due_amount, 0);
});
