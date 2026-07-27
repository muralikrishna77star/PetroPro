import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { customersRepo } = await import("./customers.js");
const { itemsRepo } = await import("./items.js");
const { ordersRepo } = await import("./orders.js");

customersRepo.create({ code: "CUST1", name: "Test Customer" } as never);
itemsRepo.create({
  code: "PET",
  name: "Petrol",
  price_wholesale: 96.72,
  price_retail: 96.72,
  purchase_value: 92.0,
  tax_percent: 18,
});

test("create() inserts an order + its lines as one unit", () => {
  const order = ordersRepo.create({
    customerCode: "CUST1",
    lines: [{ item_code: "PET", qty_ordered: 100, rate_at_order: 96.72 }],
  });
  assert.equal(order.customer_code, "CUST1");
  assert.equal(order.status, "open");
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].qty_served, 0);
});

test("listOpenByCustomer only returns open/partially_served orders", () => {
  const openOrder = ordersRepo.create({
    customerCode: "CUST1",
    lines: [{ item_code: "PET", qty_ordered: 50, rate_at_order: 96.72 }],
  });
  const cancelledOrder = ordersRepo.create({
    customerCode: "CUST1",
    lines: [{ item_code: "PET", qty_ordered: 20, rate_at_order: 96.72 }],
  });
  ordersRepo.cancel(cancelledOrder.order_no, "CUST1");

  const open = ordersRepo.listOpenByCustomer("CUST1");
  assert.ok(open.some((o) => o.order_no === openOrder.order_no));
  assert.ok(!open.some((o) => o.order_no === cancelledOrder.order_no));
});

test("applyFulfillment increments qty_served and moves status open -> partially_served -> completed", () => {
  const order = ordersRepo.create({
    customerCode: "CUST1",
    lines: [{ item_code: "PET", qty_ordered: 100, rate_at_order: 96.72 }],
  });
  const lineId = order.lines[0].id;

  ordersRepo.applyFulfillment(lineId, 40);
  assert.equal(ordersRepo.get(order.order_no)?.status, "partially_served");
  assert.equal(ordersRepo.getLine(lineId)?.qty_served, 40);

  ordersRepo.applyFulfillment(lineId, 60);
  assert.equal(ordersRepo.get(order.order_no)?.status, "completed");
  assert.equal(ordersRepo.getLine(lineId)?.qty_served, 100);
});

test("applyFulfillment refuses to exceed the ordered quantity", () => {
  const order = ordersRepo.create({
    customerCode: "CUST1",
    lines: [{ item_code: "PET", qty_ordered: 10, rate_at_order: 96.72 }],
  });
  const lineId = order.lines[0].id;
  ordersRepo.applyFulfillment(lineId, 6);
  assert.throws(() => ordersRepo.applyFulfillment(lineId, 5), /exceed/i);
  assert.equal(ordersRepo.getLine(lineId)?.qty_served, 6);
});

test("cancel() marks an order cancelled and rejects a second cancellation", () => {
  const order = ordersRepo.create({
    customerCode: "CUST1",
    lines: [{ item_code: "PET", qty_ordered: 10, rate_at_order: 96.72 }],
  });
  const cancelled = ordersRepo.cancel(order.order_no, "CUST1");
  assert.equal(cancelled.status, "cancelled");
  assert.throws(() => ordersRepo.cancel(order.order_no, "CUST1"), /already cancelled/i);
});
