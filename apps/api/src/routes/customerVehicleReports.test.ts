import test from "node:test";
import assert from "node:assert/strict";
process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const { hashPassword } = await import("../services/auth.js");
const { usersRepo } = await import("../repositories/users.js");
const { createSession } = await import("../services/sessions.js");
const app = await buildApp(); app.log.level = "silent";
test.after(() => app.close());
db.exec(`INSERT INTO customers (code, name) VALUES ('A', 'Alpha'), ('B', 'Beta');
  INSERT INTO items (code, name) VALUES ('D', 'Diesel');
  INSERT INTO vehicles (vehicle_no, customer_code) VALUES ('SHARED', 'A'), ('AONLY', 'A');`);
for (const [n, customer, vehicle, date, payment, status, qty] of [
  [1, 'A', 'SHARED', '2026-11-01', 'credit', 'active', 10],
  [2, 'A', 'AONLY', '2026-11-02', 'credit', 'active', 20],
  [3, 'B', 'SHARED', '2026-11-01', 'credit', 'active', 99],
  [4, 'A', 'SHARED', '2026-10-01', 'credit', 'active', 8],
  [5, 'A', 'SHARED', '2026-11-01', 'credit', 'cancelled', 7],
  [6, 'A', 'SHARED', '2026-11-01', 'cash', 'active', 5],
] as const) {
  db.prepare("INSERT INTO bills (bill_no, customer_code, vehicle_no, bill_date, payment_type, status, grand_total) VALUES (?, ?, ?, ?, ?, ?, ?)").run(n, customer, vehicle, date, payment, status, qty * 90);
  db.prepare("INSERT INTO bill_lines (bill_no, item_code, qty, rate, rate_pretax, amount) VALUES (?, 'D', ?, 90, 90, ?)").run(n, qty, qty * 90);
  db.prepare("INSERT INTO mileage_log (bill_no, vehicle_no, item_code, odometer_prev, odometer_curr, qty, mileage) VALUES (?, ?, 'D', 1000, 1100, ?, ?)").run(n, vehicle, qty, 100 / qty);
}
const token = app.jwt.sign({ sub: "A", name: "Alpha", role: "customer" });
const get = (path: string, bearer = token) => app.inject({ method: "GET", url: path, headers: { authorization: `Bearer ${bearer}` } });
const range = "from=2026-11-01&to=2026-11-30";

test("customer statement groups only own credit sales, including with a shared vehicle", async () => {
  const res = await get(`/customer/reports/statement?${range}&group_by_vehicle=1&with_opening=1&customerCode=B`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().customer.code, "A");
  assert.equal(res.json().form, "CWSGWO");
  assert.deepEqual(res.json().lines.map((l: { bill_no: number }) => l.bill_no), [2, 1]);
  assert.equal(res.json().total_amount, 2700);
  const filtered = await get(`/customer/reports/statement?${range}&vehicle_no=SHARED`);
  assert.deepEqual(filtered.json().lines.map((l: { bill_no: number }) => l.bill_no), [1]);
});
test("mileage is scoped through bill ownership, date and cancelled status", async () => {
  const res = await get(`/customer/reports/mileage?${range}&vehicle_no=shared&customerCode=B`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().rows.map((r: { bill_no: number }) => r.bill_no), [1, 6]);
  assert.equal(res.json().rows[0].mileage, 10);
  assert.equal(res.json().rows[0].bill_date, "2026-11-01");
  assert.equal((await get(`/customer/reports/mileage?${range}&vehicle_no=NOTMINE`)).json().rows.length, 0);
});
test("statement PDF requires customer auth and returns no-store PDF", async () => {
  const url = `/customer/reports/statement.pdf?${range}`;
  assert.equal((await get(url, "invalid")).statusCode, 401);
  const res = await get(url);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /application\/pdf/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.rawPayload.subarray(0, 4).toString(), '%PDF');
});
test("invalid dates are rejected by all new report endpoints", async () => {
  for (const path of ['statement', 'statement.pdf', 'mileage']) {
    assert.equal((await get(`/customer/reports/${path}?from=2026-02-30&to=2026-11-30`)).statusCode, 400);
  }
});
test("staff credit mileage uses selected customer and dates; customer cannot use staff endpoint", async () => {
  usersRepo.create({ user_id: 'boss', name: 'Boss', role: 'super_admin', password_hash: hashPassword('test') });
  const staff = app.signAccessToken({ user_id: 'boss', name: 'Boss', role: 'super_admin' }, createSession('boss', 'password', undefined).sessionId);
  const url = `/reports/customers/A/mileage?${range}&vehicle_no=SHARED`;
  assert.equal((await get(url)).statusCode, 403);
  const res = await get(url, staff);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().rows.map((r: { bill_no: number }) => r.bill_no), [1]);
  assert.equal((await get(`/customer/reports/mileage?${range}`, staff)).statusCode, 403);
});
