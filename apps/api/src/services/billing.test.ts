import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { itemsRepo } = await import("../repositories/items.js");
const { customersRepo } = await import("../repositories/customers.js");
const { usersRepo } = await import("../repositories/users.js");
const { stockRepo } = await import("../repositories/stock.js");
const { createWalkInBill, cancelBill, settlePendingTransaction } = await import("./billing.js");
const { pendingTransactionsRepo } = await import("../repositories/pendingTransactions.js");
const { billsRepo } = await import("../repositories/bills.js");
const { pumpsRepo } = await import("../repositories/pumps.js");

itemsRepo.create({
  code: "OIL",
  name: "Engine Oil",
  price_wholesale: 350,
  price_retail: 399,
  purchase_value: 280,
  tax_percent: 18,
});
usersRepo.create({ user_id: "cashier1", name: "Cashier", password_hash: "x", role: "operator" });
usersRepo.create({ user_id: "attendant1", name: "Attendant", password_hash: "x", role: "field_operator" });
customersRepo.create({ code: "CUST1", name: "Test Customer", credit_limit: 1000, service_charge: 0 } as never);
pumpsRepo.create({ code: "P1", name: "Pump 1" });
pumpsRepo.create({ code: "P2", name: "Pump 2" });

test("createWalkInBill computes totals and decrements stock", () => {
  const result = createWalkInBill({
    cashierId: "cashier1",
    paymentType: "cash",
    lines: [{ item_code: "OIL", qty: 2 }],
  });
  assert.equal(result.bill.grand_total, 798);
  assert.equal(result.lines.length, 1);

  const today = new Date().toISOString().slice(0, 10);
  const stock = stockRepo.getRow("OIL", today);
  assert.equal(stock?.sales, 2);
  assert.equal(stock?.balance, -2);
});

test("createWalkInBill rejects a credit bill exceeding the customer's credit limit", () => {
  assert.throws(
    () =>
      createWalkInBill({
        cashierId: "cashier1",
        paymentType: "credit",
        customerCode: "CUST1",
        lines: [{ item_code: "OIL", qty: 10 }], // 3990 > 1000 credit limit
      }),
    /credit limit/i,
  );
});

test("createWalkInBill accepts a credit bill within the limit and updates due_amount", () => {
  const before = customersRepo.get("CUST1")!.due_amount;
  const result = createWalkInBill({
    cashierId: "cashier1",
    paymentType: "credit",
    customerCode: "CUST1",
    lines: [{ item_code: "OIL", qty: 1 }],
  });
  const after = customersRepo.get("CUST1")!.due_amount;
  assert.equal(after - before, result.bill.grand_total);
});

test("createWalkInBill persists an order number for credit sales", () => {
  const result = createWalkInBill({
    cashierId: "cashier1",
    paymentType: "credit",
    customerCode: "CUST1",
    orderNo: "PO-1001",
    lines: [{ item_code: "OIL", qty: 1 }],
  });
  assert.equal(result.bill.order_no, "PO-1001");
  assert.equal(billsRepo.get(result.bill.bill_no)?.order_no, "PO-1001");
});

test("createWalkInBill leaves order_no null when not supplied", () => {
  const result = createWalkInBill({
    cashierId: "cashier1",
    paymentType: "cash",
    lines: [{ item_code: "OIL", qty: 1 }],
  });
  assert.equal(result.bill.order_no, null);
});

test("createWalkInBill persists a pump code", () => {
  const result = createWalkInBill({
    cashierId: "cashier1",
    paymentType: "cash",
    pumpCode: "P1",
    lines: [{ item_code: "OIL", qty: 1 }],
  });
  assert.equal(result.bill.pump_code, "P1");
});

test("billsRepo.listRecent returns the newest bills first, most recent limited", () => {
  const first = createWalkInBill({ cashierId: "cashier1", paymentType: "cash", lines: [{ item_code: "OIL", qty: 1 }] });
  const second = createWalkInBill({ cashierId: "cashier1", paymentType: "cash", lines: [{ item_code: "OIL", qty: 1 }] });
  const recent = billsRepo.listRecent(2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].bill_no, second.bill.bill_no);
  assert.equal(recent[1].bill_no, first.bill.bill_no);
});

test("cancelBill reverses stock and rejects a second cancellation", () => {
  const result = createWalkInBill({
    cashierId: "cashier1",
    paymentType: "cash",
    lines: [{ item_code: "OIL", qty: 3 }],
  });
  const today = new Date().toISOString().slice(0, 10);
  const beforeCancel = stockRepo.getRow("OIL", today)!.sales;

  const cancelled = cancelBill(result.bill.bill_no, "cashier1");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelled_by, "cashier1");

  const afterCancel = stockRepo.getRow("OIL", today)!.sales;
  assert.equal(afterCancel, beforeCancel - 3);

  assert.throws(() => cancelBill(result.bill.bill_no, "cashier1"), /already cancelled/i);
});

test("createWalkInBill refuses to post against a closed stock day, and creates no bill", () => {
  const today = new Date().toISOString().slice(0, 10);
  const billsBefore = db.prepare("SELECT COUNT(*) AS n FROM bills").get() as { n: number };

  stockRepo.closeDay(today);
  assert.throws(
    () =>
      createWalkInBill({
        cashierId: "cashier1",
        paymentType: "cash",
        lines: [{ item_code: "OIL", qty: 1 }],
      }),
    /closed/i,
  );

  const billsAfter = db.prepare("SELECT COUNT(*) AS n FROM bills").get() as { n: number };
  assert.equal(billsAfter.n, billsBefore.n);

  db.prepare("UPDATE stock_daybook SET closed = 0 WHERE sdate = ?").run(today);
});

test("cancelBill refuses to reverse a sale posted on a now-closed day", () => {
  const today = new Date().toISOString().slice(0, 10);
  const result = createWalkInBill({
    cashierId: "cashier1",
    paymentType: "cash",
    lines: [{ item_code: "OIL", qty: 1 }],
  });

  stockRepo.closeDay(today);
  assert.throws(() => cancelBill(result.bill.bill_no, "cashier1"), /closed/i);
  assert.equal(billsRepoStatus(result.bill.bill_no), "active");

  db.prepare("UPDATE stock_daybook SET closed = 0 WHERE sdate = ?").run(today);
});

function billsRepoStatus(billNo: number): string {
  return (db.prepare("SELECT status FROM bills WHERE bill_no = ?").get(billNo) as { status: string })
    .status;
}

test("settlePendingTransaction turns a pending fuel entry into exactly one bill", () => {
  const pending = pendingTransactionsRepo.create({
    vehicle_no: "KA01AB1234",
    item_code: "OIL",
    qty: 1,
    attendant_id: "attendant1",
  });
  const result = settlePendingTransaction({
    pendingId: pending.id,
    cashierId: "cashier1",
    paymentType: "cash",
  });
  assert.equal(result.bill.vehicle_no, "KA01AB1234");

  const settled = pendingTransactionsRepo.get(pending.id);
  assert.equal(settled?.status, "settled");
  assert.equal(settled?.bill_no, result.bill.bill_no);

  assert.throws(
    () => settlePendingTransaction({ pendingId: pending.id, cashierId: "cashier1", paymentType: "cash" }),
    /already settled/i,
  );
});

test("settlePendingTransaction carries the pump code from the pending entry onto the bill", () => {
  const pending = pendingTransactionsRepo.create({
    vehicle_no: "KA02CD5678",
    item_code: "OIL",
    qty: 1,
    attendant_id: "attendant1",
    pump_code: "P2",
  });
  const result = settlePendingTransaction({
    pendingId: pending.id,
    cashierId: "cashier1",
    paymentType: "cash",
  });
  assert.equal(result.bill.pump_code, "P2");
});
