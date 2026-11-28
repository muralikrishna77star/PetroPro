import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const { hashPassword } = await import("../services/auth.js");
const { itemsRepo } = await import("../repositories/items.js");
const { businessDateRepo } = await import("../repositories/businessDate.js");

const app = await buildApp();
app.log.level = "silent";
test.after(() => app.close());

db.exec(`
  INSERT INTO users (user_id, name, password_hash, role) VALUES
    ('ravi', 'Ravi', '${hashPassword("ravi-pass")}', 'operator'),
    ('sita', 'Sita', '${hashPassword("sita-pass")}', 'operator');
`);
itemsRepo.create({ code: "DSL", name: "DIESEL", price_wholesale: 90, price_retail: 90, purchase_value: 85, tax_percent: 0 });
itemsRepo.create({ code: "OIL", name: "ENGINE OIL", price_wholesale: 400, price_retail: 400, purchase_value: 300, tax_percent: 0 });

async function login(user_id: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { user_id, password } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().token as string;
}
const ravi = await login("ravi", "ravi-pass");
const sita = await login("sita", "sita-pass");
const call = (method: "GET" | "POST", url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
const bill = (token: string, lines: { item_code: string; qty: number }[]) =>
  call("POST", "/bills", token, { paymentType: "cash", lines });

test("Close Day shows the day's sales and the closing cashier's own, by item, then closes", async () => {
  const date = businessDateRepo.get();
  assert.equal((await bill(ravi, [{ item_code: "DSL", qty: 10 }, { item_code: "OIL", qty: 1 }])).statusCode, 201);
  assert.equal((await bill(sita, [{ item_code: "DSL", qty: 5 }])).statusCode, 201);
  const cancelled = (await bill(ravi, [{ item_code: "DSL", qty: 100 }])).json();
  // A cancelled bill counts for nothing.
  db.prepare("UPDATE bills SET status = 'cancelled' WHERE bill_no = ?").run(cancelled.bill.bill_no);

  const res = await call("GET", "/stock/close/summary", sita);
  assert.equal(res.statusCode, 200, res.body);
  const summary = res.json();
  assert.equal(summary.date, date);
  assert.equal(summary.day.bill_count, 2);
  assert.equal(summary.day.amount, 1750);
  assert.deepEqual(
    summary.day.items.map((i: { item_code: string; qty: number; amount: number }) => [i.item_code, i.qty, i.amount]),
    [["DSL", 15, 1350], ["OIL", 1, 400]],
  );
  // The business date rolls over at UTC midnight, 05:30 at the station (Asia/Kolkata default).
  if (!process.env.STATION_TIME_ZONE) assert.match(summary.next_date_opens_at, /05:30/);
  assert.equal(summary.cashier.name, "Sita");
  assert.equal(summary.cashier.bill_count, 1);
  assert.deepEqual(summary.cashier.items.map((i: { qty: number }) => i.qty), [5]);

  const closed = await call("POST", "/stock/close", sita, {});
  assert.equal(closed.statusCode, 200, closed.body);
  assert.equal(closed.json().closedDate, date);
  assert.equal(closed.json().summary.day.amount, 1750);
  assert.equal(closed.json().summary.next_date > date, true);
});
