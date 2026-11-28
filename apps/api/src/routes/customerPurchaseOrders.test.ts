import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const { hashPassword } = await import("../services/auth.js");
const { customersRepo } = await import("../repositories/customers.js");
const { itemsRepo } = await import("../repositories/items.js");
const { ordersRepo } = await import("../repositories/orders.js");

const app = await buildApp();
app.log.level = "silent";
test.after(() => app.close());

db.exec(`INSERT INTO users (user_id, name, password_hash, role) VALUES ('desk', 'Counter', '${hashPassword("desk-pass")}', 'operator')`);
for (const code of ["FLEET", "OTHER"]) {
  customersRepo.create({ code, name: `Customer ${code}`, email: `${code}@test.com`, joined_on: null, address: null, print_name: null, phone: null, credit_limit: 0, service_charge: 0, tin_no: null, gst_no: null });
  customersRepo.setPasswordHash(code, hashPassword("test-password"));
}
itemsRepo.create({ code: "DSL", name: "DIESEL", price_wholesale: 92.75, price_retail: 92.75, purchase_value: 89, tax_percent: 0 });
itemsRepo.create({ code: "OIL", name: "ENGINE OIL", price_wholesale: 350, price_retail: 399, purchase_value: 280, tax_percent: 18 });

const call = (method: "GET" | "POST", url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });

const customerLogin = await app.inject({ method: "POST", url: "/customer/auth/login", payload: { email: "FLEET@test.com", password: "test-password" } });
assert.equal(customerLogin.statusCode, 200, customerLogin.body);
const customer = customerLogin.json().token as string;
const staffLogin = await app.inject({ method: "POST", url: "/auth/login", payload: { user_id: "desk", password: "desk-pass" } });
assert.equal(staffLogin.statusCode, 200, staffLogin.body);
const staff = staffLogin.json().token as string;

test("a customer's purchase order is always their own, with the extra-items choice and vehicle kept", async () => {
  const res = await call("POST", "/customer/orders", customer, {
    customer_code: "OTHER",
    allow_extra_items: true,
    vehicle_no: " tn01ab1234 ",
    lines: [{ item_code: "DSL", qty: 100 }],
  });
  assert.equal(res.statusCode, 201, res.body);
  const order = res.json();
  assert.equal(order.customer_code, "FLEET");
  assert.equal(order.allow_extra_items, 1);
  assert.equal(order.vehicle_no, "TN01AB1234");
});

test("Billing lists the customer's open purchase orders and bills one, refusing extras on a strict order", async () => {
  const placed = await call("POST", "/customer/orders", customer, { lines: [{ item_code: "DSL", qty: 50 }] });
  assert.equal(placed.statusCode, 201, placed.body);
  const order = placed.json();
  assert.equal(order.allow_extra_items, 0);

  const listed = await call("GET", "/orders?customer_code=FLEET", staff);
  assert.ok(listed.json().some((o: { order_no: number }) => o.order_no === order.order_no));

  const orderLine = { item_code: "DSL", qty: 30, orderLineId: order.lines[0].id };
  const withExtra = await call("POST", "/bills", staff, {
    paymentType: "credit",
    customerCode: "FLEET",
    fulfillOrderNo: order.order_no,
    lines: [orderLine, { item_code: "OIL", qty: 1 }],
  });
  assert.equal(withExtra.statusCode, 400);
  assert.match(withExtra.json().error, /doesn't allow additional items/);

  const billed = await call("POST", "/bills", staff, {
    paymentType: "credit",
    customerCode: "FLEET",
    fulfillOrderNo: order.order_no,
    lines: [orderLine],
  });
  assert.equal(billed.statusCode, 201, billed.body);
  assert.equal(ordersRepo.getLine(order.lines[0].id)?.qty_served, 30);
  assert.equal(ordersRepo.get(order.order_no)?.status, "partially_served");
});

test("Billing can't bill a purchase order under another customer", async () => {
  const order = (await call("POST", "/customer/orders", customer, { lines: [{ item_code: "DSL", qty: 10 }] })).json();
  const res = await call("POST", "/bills", staff, {
    paymentType: "credit",
    customerCode: "OTHER",
    fulfillOrderNo: order.order_no,
    lines: [{ item_code: "DSL", qty: 10, orderLineId: order.lines[0].id }],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /different customer/);
});
