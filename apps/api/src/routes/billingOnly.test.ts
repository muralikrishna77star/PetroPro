import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const { hashPassword } = await import("../services/auth.js");
const { itemsRepo } = await import("../repositories/items.js");
const { BILLING_ONLY_ROUTES, BILLING_ONLY_REFUSAL } = await import("../plugins/auth.js");

const app = await buildApp();
app.log.level = "silent";
test.after(() => app.close());

db.exec(`
  INSERT INTO users (user_id, name, password_hash, role) VALUES
    ('boss', 'Boss', '${hashPassword("boss-pass")}', 'super_admin'),
    ('tab1', 'Tablet One', '${hashPassword("tab-pass")}', 'operator'),
    ('desk', 'Counter Cashier', '${hashPassword("desk-pass")}', 'operator');
`);
itemsRepo.create({ code: "DSL", name: "DIESEL", price_wholesale: 92.75, price_retail: 92.75, purchase_value: 89, tax_percent: 0 });

const call = (method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE", url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });

async function login(user_id: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { user_id, password } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as { token: string; user: { billing_only: boolean } };
}

const boss = (await login("boss", "boss-pass")).token;
const setBillingOnly = (userId: string, role: string, billing_only?: boolean) =>
  call("PUT", `/users/${userId}`, boss, { name: userId === "tab1" ? "Tablet One" : "Someone", role, ...(billing_only === undefined ? {} : { billing_only }) });

test("every route a billing-only cashier is allowed is a real route", () => {
  for (const entry of BILLING_ONLY_ROUTES) {
    const [method, url] = entry.split(" ");
    assert.ok(app.hasRoute({ method: method as "GET", url }), `${entry} isn't a registered route, so Billing would break`);
  }
});

test("Billing screen only is for cashiers, and is cleared when the role changes", async () => {
  const forOwner = await call("POST", "/users", boss, { user_id: "own2", name: "Owner Two", role: "owner", billing_only: true });
  assert.equal(forOwner.statusCode, 400);
  assert.match(forOwner.json().error, /cashier/);

  const created = await call("POST", "/users", boss, { user_id: "tab2", name: "Tablet Two", role: "operator", billing_only: true, password: "tab2-pass" });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().billing_only, 1);

  assert.equal((await setBillingOnly("tab2", "owner", true)).statusCode, 400);
  const promoted = await setBillingOnly("tab2", "owner");
  assert.equal(promoted.json().billing_only, 0, "a promoted user isn't left limited to Billing");

  const listed = (await call("GET", "/users", boss)).json() as { user_id: string; billing_only: number }[];
  assert.equal(listed.find((u) => u.user_id === "tab2")?.billing_only, 0);
  const audit = db.prepare("SELECT details FROM audit_logs WHERE action = 'update_user' AND entity_id = 'tab2' ORDER BY id DESC").get() as { details: string };
  assert.match(audit.details, /"billing_only":false/);
});

test("signing in says the account is billing only, and leaving the flag out of an edit keeps it", async () => {
  assert.equal((await setBillingOnly("tab1", "operator", true)).json().billing_only, 1);
  assert.equal((await login("tab1", "tab-pass")).user.billing_only, true);
  assert.equal((await login("desk", "desk-pass")).user.billing_only, false);
  assert.equal((await setBillingOnly("tab1", "operator")).json().billing_only, 1, "an edit that doesn't mention it keeps it");
});

test("a billing-only cashier can bill, look up, print and share", async () => {
  await setBillingOnly("tab1", "operator", true);
  const tab = (await login("tab1", "tab-pass")).token;
  for (const url of ["/items", "/pumps", "/customers", "/tenant", "/business-date", "/bills/recent"]) {
    assert.equal((await call("GET", url, tab)).statusCode, 200, url);
  }
  const bill = await call("POST", "/bills", tab, { paymentType: "cash", lines: [{ item_code: "DSL", qty: 10 }] });
  assert.equal(bill.statusCode, 201, bill.body);
  const billNo = bill.json().bill.bill_no as number;
  assert.equal((await call("GET", `/bills/${billNo}`, tab)).statusCode, 200);
  assert.equal((await call("GET", `/bills/${billNo}/receipt?terminal_id=tablet-0000-0001`, tab)).statusCode, 200);
  const printed = await call("POST", `/bills/${billNo}/print-jobs`, tab, { request_key: "tab-print-0001", terminal_id: "tablet-0000-0001" });
  assert.equal(printed.statusCode, 200, printed.body);
  assert.equal((await call("PATCH", `/print-jobs/${printed.json().job.id}`, tab, { status: "sent" })).statusCode, 200);
  assert.equal((await call("GET", `/bills/${billNo}/share-link`, tab)).statusCode, 200);
});

test("everything else answers that the account can only use Billing, and Close Day is refused", async () => {
  await setBillingOnly("tab1", "operator", true);
  const tab = (await login("tab1", "tab-pass")).token;
  const refused: [method: "GET" | "POST" | "PUT", url: string][] = [
    ["POST", "/stock/close"],
    ["GET", "/reports/gst?from=2026-01-01&to=2026-12-31"],
    ["GET", "/shifts"],
    ["GET", "/pending-transactions"],
    ["POST", "/customers"],
    ["GET", "/print-jobs/unfinished"],
    ["GET", "/print/stations"],
  ];
  for (const [method, url] of refused) {
    const res = await call(method, url, tab, method === "GET" ? undefined : {});
    assert.equal(res.statusCode, 403, `${method} ${url} should be refused, got ${res.statusCode}`);
    assert.equal(res.json().error, BILLING_ONLY_REFUSAL, `${method} ${url}`);
  }
});

test("a normal cashier is unaffected, and switching the option off works at once", async () => {
  const desk = (await login("desk", "desk-pass")).token;
  assert.equal((await call("GET", "/pending-transactions", desk)).statusCode, 200, "the Cashier Queue still works for a normal cashier");

  await setBillingOnly("tab1", "operator", true);
  const tab = (await login("tab1", "tab-pass")).token;
  assert.equal((await call("GET", "/pending-transactions", tab)).statusCode, 403);
  await setBillingOnly("tab1", "operator", false);
  assert.equal((await call("GET", "/pending-transactions", tab)).statusCode, 200, "the same sign-in, no new token needed");
  await setBillingOnly("tab1", "operator", true);
  assert.equal((await call("GET", "/pending-transactions", tab)).statusCode, 403, "and back on, at once");
});
