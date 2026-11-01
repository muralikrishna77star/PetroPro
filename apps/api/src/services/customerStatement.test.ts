import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { itemsRepo } = await import("../repositories/items.js");
const { customersRepo } = await import("../repositories/customers.js");
const { getCustomerStatement } = await import("./customerStatement.js");

itemsRepo.create({ code: "HSD", name: "Diesel", price_wholesale: 90, price_retail: 90, purchase_value: 85, tax_percent: 0 });
itemsRepo.create({ code: "OIL", name: "Engine Oil", price_wholesale: 350, price_retail: 400, purchase_value: 280, tax_percent: 18 });
customersRepo.create({ code: "FLEET", name: "Fleet Movers", service_charge: 2 } as never);
customersRepo.create({ code: "BIG", name: "Big Fleet", service_charge: 0 } as never);
db.prepare("UPDATE tenants SET name = ?, address_line1 = ?, address_line2 = ?, tagline = ? WHERE id = 1").run(
  "SRINIVASA AGENCIES",
  "DEALERS OF IOCL",
  "#490, G.N.T ROAD",
  "USE ALWAYS SERVO LUBRICANTS",
);

let nextBill = 1;
function bill(
  customer: string,
  date: string,
  vehicle: string,
  lines: [string, number, number][],
  extra: { payment?: string; status?: string; orderNo?: string } = {},
) {
  const total = lines.reduce((s, [, qty, rate]) => s + qty * rate, 0);
  const billNo = nextBill++;
  db.prepare(
    `INSERT INTO bills (bill_no, bill_date, vehicle_no, customer_code, grand_total, sub_total, payment_type, status, order_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(billNo, `${date} 10:00:00`, vehicle, customer, total, total, extra.payment ?? "credit", extra.status ?? "active", extra.orderNo ?? null);
  for (const [item, qty, rate] of lines) {
    db.prepare(
      "INSERT INTO bill_lines (bill_no, item_code, qty, rate, rate_pretax, amount) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(billNo, item, qty, rate, rate, qty * rate);
  }
}

db.prepare("INSERT INTO vehicles (vehicle_no, customer_code) VALUES ('TN01AB1111', 'FLEET'), ('TN02CD2222', 'FLEET')").run();
db.prepare("INSERT INTO opening_balances (customer_code, op_date, op_balance) VALUES ('FLEET', '2026-03-01', 1000)").run();
bill("FLEET", "2026-03-15", "TN01AB1111", [["HSD", 10, 90]]); // before range: 900
db.prepare("INSERT INTO receipts (rec_date, customer_code, amount) VALUES ('2026-03-20 09:00:00', 'FLEET', 400)").run();
bill("FLEET", "2026-04-02", "TN02CD2222", [["HSD", 20, 90], ["OIL", 1, 400]], { orderNo: "PO7" }); // 2200
bill("FLEET", "2026-04-01", "TN01AB1111", [["HSD", 15.5, 90]]); // 1395
bill("FLEET", "2026-04-03", "TN01AB1111", [["HSD", 5, 90]], { status: "cancelled" });
bill("FLEET", "2026-04-03", "TN01AB1111", [["HSD", 5, 90]], { payment: "cash" });
db.prepare("INSERT INTO receipts (rec_date, customer_code, amount) VALUES ('2026-04-10 09:00:00', 'FLEET', 1500)").run();

const range = { customerCode: "FLEET", from: "2026-04-01", to: "2026-04-30" };

test("CWS: credit, non-cancelled lines in date/bill order with legacy totals", () => {
  const s = getCustomerStatement(range, "2026-05-01");
  assert.equal(s.form, "CWS");
  assert.deepEqual(
    s.lines.map((l) => [l.bill_date, l.item_name, l.amount]),
    [
      ["2026-04-01", "Diesel", 1395],
      ["2026-04-02", "Diesel", 1800],
      ["2026-04-02", "Engine Oil", 400],
    ],
  );
  assert.equal(s.bill_count, 2);
  assert.equal(s.total_amount, 3595);
  assert.equal(s.service_charge_amount, 71.9); // 2% of 3595
  assert.equal(s.net_balance, 3666.9);
  assert.equal(s.net_amount, 3667);
  assert.equal(s.round_off, 0.1);
  assert.equal(s.amount_in_words, "Three Thousand Six hundred Sixty Seven Rupees Only");

  assert.equal(s.pages.length, 1);
  const page = s.pages[0];
  assert.equal(page.length, 66);
  assert.match(page[0], /SALES REPORT OF FLEET MOVERS From 01\/04\/2026 To 30\/04\/2026/);
  assert.equal(page[4].trim(), "SRINIVASA AGENCIES");
  assert.match(page[6], /01\/05\/2026$/);
  assert.ok(page.some((l) => l.startsWith("Bill_date       Bill_no      Ref No.")));
  const detail = page.find((l) => l.includes("Engine Oil"))!;
  assert.equal(detail.slice(29, 35), "   PO7");
  assert.equal(detail.slice(108, 118), "    400.00");
  const grand = page.find((l) => l.includes("Grand Total:"))!;
  assert.match(grand, /^No\. of Bills : 2/);
  assert.match(grand, /Rs\.\s+3,595\.00$/);
  assert.ok(page.some((l) => /Net Amount :Rs\.\s+3,667\.00$/.test(l)));
  assert.equal(page.at(-1)!.trim(), "USE ALWAYS SERVO LUBRICANTS");
});

test("CWSWO: opening balance as on From date and receipts in range", () => {
  const s = getCustomerStatement({ ...range, withOpening: true });
  assert.equal(s.form, "CWSWO");
  assert.equal(s.opening_balance, 1500); // 1000 opening + 900 bill - 400 receipt
  assert.equal(s.receipts, 1500);
  assert.equal(s.net_balance, 3666.9); // 3595 + 71.90 + 1500 - 1500
  const page = s.pages[0];
  assert.ok(page.some((l) => /Opening Balance as on 01\/04\/2026\s+1500\.00$/.test(l)));
  assert.ok(page.some((l) => /Grand Total:Rs\.\s+5,095\.00$/.test(l)));
  assert.ok(page.some((l) => /Receipts From 01\/04\/2026 To 30\/04\/2026 Rs\.\s+1500\.00$/.test(l)));
});

test("vehicle filter is a legacy prefix match", () => {
  const s = getCustomerStatement({ ...range, vehicleNo: "tn01" });
  assert.deepEqual([...new Set(s.lines.map((l) => l.vehicle_no))], ["TN01AB1111"]);
});

test("CWSG: grouped by vehicle with per-vehicle totals", () => {
  const s = getCustomerStatement({ ...range, groupByVehicle: true });
  assert.equal(s.form, "CWSG");
  assert.equal(s.width, 75);
  assert.deepEqual(s.lines.map((l) => l.vehicle_no), ["TN01AB1111", "TN02CD2222", "TN02CD2222"]);
  const totals = s.pages[0].filter((l) => l.includes("Vehicle Wise Total Amt :")).map((l) => l.slice(62).trim());
  assert.deepEqual(totals, ["1395.00", "2200.00"]);
  assert.ok(s.pages[0].every((l) => l.length <= 75));
});

test("pagination carries the running balance forward page to page", () => {
  db.prepare("INSERT INTO vehicles (vehicle_no, customer_code) VALUES ('KA01', 'BIG')").run();
  for (let i = 0; i < 70; i++) bill("BIG", "2026-04-05", "KA01", [["HSD", 1, 100]]);
  const s = getCustomerStatement({ customerCode: "BIG", from: "2026-04-01", to: "2026-04-30" });
  assert.equal(s.pages.length, 2);
  assert.ok(s.pages.every((p) => p.length === 66));
  // Page 1: heading + 6 title + 4 header rows, then details up to the 3-row footer.
  const onPage1 = s.pages[0].filter((l) => l.includes("Diesel")).length;
  assert.equal(onPage1, 66 - 3 - 11);
  const cf = s.pages[0].find((l) => l.includes("Balance C/F"))!;
  assert.match(cf, new RegExp(`${onPage1 * 100}\\.00$`));
  assert.match(s.pages[1].find((l) => l.includes("Balance B/D"))!, new RegExp(`${onPage1 * 100}\\.00$`));
  assert.ok(!s.pages[1].some((l) => l.includes("Balance C/F")));
});
