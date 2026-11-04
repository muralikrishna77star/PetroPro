import test from "node:test";
import assert from "node:assert/strict";
process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const { customersRepo } = await import("../repositories/customers.js");
const { hashPassword } = await import("../services/auth.js");
const app = await buildApp();
app.log.level = "silent";
test.after(() => app.close());
for (const code of ["A", "B"]) {
  customersRepo.create({ code, name: `Customer ${code}`, email: `${code}@test.com`, joined_on: null, address: null, print_name: null, phone: null, credit_limit: 5000, service_charge: 0, tin_no: null, gst_no: null });
  customersRepo.setPasswordHash(code, hashPassword("test-password"));
}
for (const [customer, amount, type, status] of [["A", 100, "credit", "final"], ["A", 50, "cash", "final"], ["A", 999, "credit", "cancelled"], ["B", 700, "credit", "final"]] as const) {
  db.prepare("INSERT INTO bills (customer_code, bill_date, grand_total, payment_type, status) VALUES (?, '2026-11-02', ?, ?, ?)").run(customer, amount, type, status);
}
const login = await app.inject({ method: "POST", url: "/customer/auth/login", payload: { email: "A@test.com", password: "test-password" } });
assert.equal(login.statusCode, 200);
const token = login.json().token;
const get = (query: string, bearer = token) => app.inject({ method: "GET", url: `/customer/reports?${query}`, headers: { authorization: `Bearer ${bearer}` } });
test("customer gets own purchases across payment types and own credit ledger", async () => {
  const res = await get("from=2026-11-01&to=2026-11-30&customerCode=B");
  assert.equal(res.statusCode, 200);
  const report = res.json();
  assert.equal(report.customer.code, "A");
  assert.deepEqual(report.purchases.map((p: { grand_total: number }) => p.grand_total), [100, 50]);
  assert.equal(report.closing_balance, 100);
  assert.equal(report.ledger.length, 2);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.doesNotMatch(res.body, /password_hash|Customer B/);
});
test("date filters preserve opening balances", async () => {
  const res = await get("from=2026-11-03&to=2026-11-04");
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().opening_balance, 100);
  assert.equal(res.json().closing_balance, 100);
  assert.deepEqual(res.json().purchases, []);
});
test("missing, impossible and reversed dates are refused", async () => {
  for (const query of ["", "from=2026-02-30&to=2026-11-04", "from=2026-11-04&to=2026-11-01", "from=x&to=x"]) {
    assert.equal((await get(query)).statusCode, 400);
  }
});
test("unauthenticated and wrong-audience tokens cannot access reports", async () => {
  assert.equal((await get("from=2026-11-01&to=2026-11-04", "invalid")).statusCode, 401);
  const invoice = app.jwt.sign({ sub: "1", role: "invoice" });
  assert.equal((await get("from=2026-11-01&to=2026-11-04", invoice)).statusCode, 403);
});
