import test from "node:test";
import assert from "node:assert/strict";
import type { MileageReport } from "@petropro/shared-types";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const { createSession } = await import("../services/sessions.js");

db.exec(`
  INSERT INTO users (user_id, name, password_hash, role) VALUES ('boss', 'Boss', 'x', 'super_admin'), ('kp', 'Cashier', 'x', 'operator');
  INSERT INTO customers (code, name, service_charge) VALUES ('A', 'Alpha', 2.5), ('B', 'Beta', 0);
  INSERT INTO items (code, name) VALUES ('D', 'Diesel'), ('O', '2T Oil');
  INSERT INTO vehicles (vehicle_no, customer_code) VALUES ('TN01AB1234', 'A'), ('TN01AB9999', 'A'), ('KA05X_77', 'B');
`);

const app = await buildApp();
app.log.level = "silent";
test.after(() => app.close());

const staff = app.signAccessToken({ user_id: "boss", role: "super_admin", name: "Boss" }, createSession("boss", "password", undefined).sessionId);
const cashier = app.signAccessToken({ user_id: "kp", role: "operator", name: "Cashier" }, createSession("kp", "password", undefined).sessionId);
const portal = app.jwt.sign({ sub: "A", name: "Alpha", role: "customer" });
const get = (url: string, token = staff) => app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} });

function bill(no: number, customer: string | null, vehicle: string, date: string, lines: [item: string, qty: number, rate: number, amount: number][], extra: { payment?: string; status?: string; order?: string } = {}) {
  db.prepare("INSERT INTO bills (bill_no, customer_code, vehicle_no, bill_date, payment_type, status, order_no, grand_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    no, customer, vehicle, `${date} 10:00:00`, extra.payment ?? "credit", extra.status ?? "active", extra.order ?? null, lines.reduce((s, l) => s + l[3], 0),
  );
  for (const [item, qty, rate, amount] of lines) {
    db.prepare("INSERT INTO bill_lines (bill_no, item_code, qty, rate, rate_pretax, amount) VALUES (?, ?, ?, ?, ?, ?)").run(no, item, qty, rate, rate, amount);
  }
}
const reading = (no: number, vehicle: string, item: string, prev: number | null, curr: number, qty: number, mileage: number | null) =>
  db.prepare("INSERT INTO mileage_log (bill_no, vehicle_no, item_code, odometer_prev, odometer_curr, qty, mileage) VALUES (?, ?, ?, ?, ?, ?, ?)").run(no, vehicle, item, prev, curr, qty, mileage);

bill(1, "A", "TN01AB1234", "2026-11-01", [["D", 10, 90, 900], ["O", 1, 150.5, 150.5]], { order: "77" });
reading(1, "TN01AB1234", "D", 1000, 1120.5, 10, 12.05);
bill(2, "A", "TN01AB1234", "2026-11-02", [["D", 5, 90, 450]]); // no odometer reading taken
bill(3, "A", "TN01AB9999", "2026-11-03", [["D", 2, 90, 180]]);
bill(4, "B", "KA05X_77", "2026-11-03", [["D", 3, 90, 270]]);
bill(5, "A", "TN01AB1234", "2026-11-04", [["D", 7, 90, 630]], { status: "cancelled" });
reading(5, "TN01AB1234", "D", 1120.5, 1200, 7, 11.5);
bill(6, null, "TN01AB1234", "2026-11-05", [["D", 1, 90, 90]], { payment: "cash" });
bill(7, "A", "TN01AB1234", "2026-10-31", [["D", 1, 90, 90]]); // before the range

const RANGE = "from=2026-11-01&to=2026-11-30";
const vehicleReport = async (query: string) => {
  const res = await get(`/reports/mileage?${query}`);
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as MileageReport;
};

test("the vehicle report shows rate and amount, and totals like Petbill's VWSMAGE", async () => {
  const report = await vehicleReport(`vehicle_no=TN01AB1234&${RANGE}`);
  const first = report.rows[0];
  assert.deepEqual([first.bill_no, first.bill_date, first.item_name, first.qty, first.rate, first.amount], [1, "2026-11-01", "Diesel", 10, 90, 900]);
  assert.deepEqual([first.odometer_prev, first.odometer_curr, first.mileage], [1000, 1120.5, 12.05]);
  assert.equal(report.bill_count, 3);
  assert.equal(report.total_qty, 17);
  assert.equal(report.total_amount, 1590.5);
  assert.equal(report.service_charge_amount, 0, "VWSMAGE has no service charge");
  assert.equal(report.net_amount, 1591);
  assert.equal(report.round_off, 0.5);
  assert.match(report.amount_in_words, /Rupees Only$/);
});

test("lines with no reading stay in, as Petbill builds this from the bill lines", async () => {
  const report = await vehicleReport(`vehicle_no=TN01AB1234&${RANGE}`);
  const oil = report.rows.find((r) => r.item_code === "O")!;
  assert.deepEqual([oil.amount, oil.odometer_curr, oil.mileage], [150.5, null, null], "a reading isn't borrowed from the diesel line");
  const unread = report.rows.find((r) => r.bill_no === 2)!;
  assert.deepEqual([unread.amount, unread.odometer_curr], [450, null]);
});

test("cancelled bills and other dates stay out", async () => {
  const report = await vehicleReport(`vehicle_no=TN01AB1234&${RANGE}`);
  assert.deepEqual([...new Set(report.rows.map((r) => r.bill_no))], [1, 2, 6]);
  const narrow = await vehicleReport("vehicle_no=TN01AB1234&from=2026-11-02&to=2026-11-02");
  assert.deepEqual(narrow.rows.map((r) => r.bill_no), [2]);
});

test("the vehicle report matches exactly by default, or containing, without wildcards leaking", async () => {
  assert.equal((await vehicleReport(`vehicle_no=TN01AB&${RANGE}`)).rows.length, 0);
  assert.equal((await vehicleReport(`vehicle_no=tn01ab1234&${RANGE}`)).bill_count, 3, "any case");
  const contains = await vehicleReport(`vehicle_no=AB&match=contains&${RANGE}`);
  assert.deepEqual([...new Set(contains.rows.map((r) => r.bill_no))], [1, 2, 3, 6]);
  assert.equal((await vehicleReport(`vehicle_no=${encodeURIComponent("%")}&match=contains&${RANGE}`)).rows.length, 0);
  assert.equal((await vehicleReport(`vehicle_no=X_77&match=contains&${RANGE}`)).rows.length, 1);
  assert.equal((await vehicleReport(`vehicle_no=X%2577&match=contains&${RANGE}`)).rows.length, 0);
});

test("the vehicle report needs a vehicle and sensible dates, and stays manager-only", async () => {
  assert.equal((await get(`/reports/mileage?${RANGE}`)).statusCode, 400);
  assert.equal((await get("/reports/mileage?vehicle_no=X&from=2026-13-40&to=2026-11-30")).statusCode, 400);
  assert.equal((await get("/reports/mileage?vehicle_no=X&from=2026-11-30&to=2026-11-01")).statusCode, 400);
  assert.equal((await get(`/reports/mileage?vehicle_no=X&${RANGE}`, cashier)).statusCode, 403);
  assert.equal((await get(`/reports/mileage?vehicle_no=X&${RANGE}`, "")).statusCode, 401);
});

test("with no dates it still covers every bill, for anything calling the old address", async () => {
  assert.equal((await vehicleReport("vehicle_no=TN01AB1234")).bill_count, 4);
});

test("the customer statement adds Petbill's service charge and rounding", async () => {
  const res = await get(`/reports/customers/A/mileage?${RANGE}`);
  assert.equal(res.statusCode, 200, res.body);
  const report = res.json() as MileageReport;
  assert.deepEqual([...new Set(report.rows.map((r) => r.bill_no))], [1, 2, 3]);
  assert.equal(report.rows[0].order_no, "77");
  assert.equal(report.total_amount, 1680.5);
  assert.equal(report.service_charge_percent, 2.5);
  assert.equal(report.service_charge_amount, 42.01);
  assert.equal(report.net_amount, 1723);
  assert.equal(report.round_off, 0.49);
});

test("the customer's own portal shows the amounts too, and only their own bills", async () => {
  const res = await get(`/customer/reports/mileage?${RANGE}`, portal);
  assert.equal(res.statusCode, 200, res.body);
  const report = res.json() as MileageReport;
  assert.deepEqual([...new Set(report.rows.map((r) => r.bill_no))], [1, 2, 3]);
  assert.equal(report.rows[0].amount, 900);
  assert.equal(report.net_amount, 1723);
  const other = (await get(`/customer/reports/mileage?${RANGE}&vehicle_no=KA05`, portal)).json() as MileageReport;
  assert.equal(other.rows.length, 0);
});

test("the customer statement's vehicle filter is Petbill's prefix match", async () => {
  const report = (await get(`/reports/customers/A/mileage?${RANGE}&vehicle_no=TN01AB9`)).json() as MileageReport;
  assert.deepEqual(report.rows.map((r) => r.bill_no), [3]);
  assert.equal(report.total_amount, 180);
});

test("a bill with two readings on one item doesn't count its amount twice", async () => {
  bill(20, "B", "KA05X_77", "2026-11-20", [["D", 4, 90, 360]]);
  reading(20, "KA05X_77", "D", 10, 20, 4, 2.5);
  reading(20, "KA05X_77", "D", 20, 40, 4, 5);
  const report = (await get(`/reports/customers/B/mileage?from=2026-11-20&to=2026-11-20`)).json() as MileageReport;
  assert.equal(report.rows.length, 1);
  assert.equal(report.total_amount, 360);
  assert.equal(report.rows[0].odometer_curr, 40, "the latest reading");
});

test("an empty range reports zero, not an error", async () => {
  const report = await vehicleReport("vehicle_no=TN01AB1234&from=2020-01-01&to=2020-01-31");
  assert.deepEqual([report.rows.length, report.bill_count, report.total_amount, report.net_amount], [0, 0, 0, 0]);
});
