import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LegacyImportReport } from "@petropro/shared-types";

// A real file, because the backup taken before an import needs one. Its own folder keeps its
// backups/ apart from the other test files'.
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "petropro-legacy-"));
process.env.DB_PATH = path.join(testDir, "test.db");

const { db } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const { parseLegacyFilename } = await import("../services/legacyImport.js");
const { createSession } = await import("../services/sessions.js");
const { listBackups } = await import("../services/backup.js");
const { getCustomerLedger } = await import("../services/ledger.js");
const { stockRepo, todayDateOnly } = await import("../repositories/stock.js");

db.exec(`
  INSERT INTO users (user_id, name, password_hash, role) VALUES ('boss', 'Boss', 'x', 'super_admin'), ('own', 'Owner', 'x', 'owner'), ('kp', 'Cashier', 'x', 'operator');
  INSERT INTO items (code, name) VALUES ('MS', 'Petrol'), ('HSD', 'Diesel');
  INSERT INTO customers (code, name) VALUES ('C01', 'Fleet Co');
`);

const app = await buildApp();
app.log.level = "silent";
test.after(async () => {
  await app.close();
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

const superToken = app.signAccessToken({ user_id: "boss", role: "super_admin", name: "Boss" }, createSession("boss", "password", undefined).sessionId);
const ownerToken = app.signAccessToken({ user_id: "own", role: "owner", name: "Owner" }, createSession("own", "password", undefined).sessionId);

type Field = [name: string, type: "C" | "N" | "D", length: number, decimals?: number];
type Row = Record<string, string | number | null>;

/** Builds a real FoxPro table byte by byte, so the tests read what Petbill writes. */
function dbf(fields: Field[], rows: Row[], deleted: Row[] = []): Buffer {
  const recordSize = 1 + fields.reduce((sum, f) => sum + f[2], 0);
  const headerSize = 32 + fields.length * 32 + 1;
  const all = [...rows.map((r) => [r, false] as const), ...deleted.map((r) => [r, true] as const)];
  const buf = Buffer.alloc(headerSize + all.length * recordSize + 1, 0x20);
  buf.fill(0, 0, 32);
  buf[0] = 0x03;
  buf.writeUInt32LE(all.length, 4);
  buf.writeUInt16LE(headerSize, 8);
  buf.writeUInt16LE(recordSize, 10);
  fields.forEach(([name, type, length, decimals], i) => {
    const at = 32 + i * 32;
    buf.fill(0, at, at + 32);
    buf.write(name, at, "latin1");
    buf[at + 11] = type.charCodeAt(0);
    buf[at + 16] = length;
    buf[at + 17] = decimals ?? 0;
  });
  buf[headerSize - 1] = 0x0d;
  all.forEach(([row, isDeleted], r) => {
    let at = headerSize + r * recordSize;
    buf[at++] = isDeleted ? 0x2a : 0x20;
    for (const [name, type, length, decimals] of fields) {
      const value = row[name];
      if (value !== null && value !== undefined) {
        const text =
          type === "N"
            ? (typeof value === "number" ? value.toFixed(decimals ?? 0) : value).padStart(length)
            : type === "D"
              ? String(value).replace(/-/g, "")
              : String(value);
        buf.write(text.slice(0, length), at, "latin1");
      }
      at += length;
    }
  });
  buf[buf.length - 1] = 0x1a;
  return buf;
}

const BILL_FIELDS: Field[] = [
  ["BILL_NO", "N", 10],
  ["VEH_NO", "C", 13],
  ["BILL_DATE", "D", 8],
  ["STATUS", "C", 1],
  ["ICODE", "C", 3],
  ["QTY", "N", 9, 3],
  ["RATE", "N", 10, 2],
  ["AMT", "N", 10, 2],
  ["USER_ID", "C", 10],
  ["CUST_CODE", "C", 5],
  ["RETAIL", "N", 1],
  ["BTIME", "C", 10],
  ["SER_CHG", "N", 10, 5],
  ["RATEBTX", "N", 8, 2],
  ["TAX_PER", "N", 8, 2],
  ["TAX_AMT", "N", 8, 2],
];
const STOCK_FIELDS: Field[] = [
  ["ICODE", "C", 3],
  ["SDATE", "D", 8],
  ["OSTOCK", "N", 10, 2],
  ["CSTOCK", "N", 10, 2],
  ["RECEIPTS", "N", 10, 2],
  ["DAMAGED", "N", 10, 2],
  ["SALES", "N", 10, 2],
  ["BALANCE", "N", 10, 2],
];
const PURCHASE_FIELDS: Field[] = [
  ["ICODE", "C", 5],
  ["QTY", "N", 10],
  ["INVNO", "N", 10],
  ["PUR_VALUE", "N", 10, 2],
  ["PUR_DATE", "D", 8],
  ["VAT_AMT", "N", 10, 2],
];

function billRow(no: number, overrides: Row = {}): Row {
  return {
    BILL_NO: no,
    VEH_NO: "TN01AB1234",
    BILL_DATE: "2025-12-05",
    STATUS: "R",
    ICODE: "MS",
    QTY: 10,
    RATE: 100,
    AMT: 1000,
    USER_ID: "kp",
    CUST_CODE: "",
    RETAIL: 1,
    BTIME: `10:00:${String(no).padStart(2, "0")}`,
    SER_CHG: 0,
    RATEBTX: 85,
    TAX_PER: 18,
    TAX_AMT: 150,
    ...overrides,
  };
}

function send(endpoint: "preview" | "commit", filename: string, content: Buffer, query = "", token = superToken) {
  return app.inject({
    method: "POST",
    url: `/legacy-import/${endpoint}?filename=${encodeURIComponent(filename)}${query}`,
    headers: { "content-type": "application/octet-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: content,
  });
}

async function preview(filename: string, content: Buffer): Promise<LegacyImportReport> {
  const res = await send("preview", filename, content);
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as LegacyImportReport;
}

async function commit(filename: string, content: Buffer, query = ""): Promise<LegacyImportReport> {
  const res = await send("commit", filename, content, query);
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as LegacyImportReport;
}

function count(sql: string, ...params: string[]): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${sql}`).get(...params) as { n: number }).n;
}

function clearData() {
  db.exec("DELETE FROM mileage_log; DELETE FROM bill_lines; DELETE FROM bills; DELETE FROM stock_daybook; DELETE FROM purchases; DELETE FROM receipts;");
  db.exec("UPDATE customers SET due_amount = 0");
}

test("only a super admin can upload", async () => {
  const file = dbf(BILL_FIELDS, [billRow(1)]);
  for (const endpoint of ["preview", "commit"] as const) {
    assert.equal((await send(endpoint, "DECBIL25.DBF", file, "", "")).statusCode, 401);
    assert.equal((await send(endpoint, "DECBIL25.DBF", file, "", ownerToken)).statusCode, 403);
  }
  assert.equal(count("bills"), 0);
});

test("file names decide the type and period, with calendar years", () => {
  assert.deepEqual(parseLegacyFilename("DECBIL25.DBF"), { kind: "sales", label: "DEC 2025", from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(parseLegacyFilename("decstk22.dbf"), { kind: "stock", label: "DEC 2022", from: "2022-12-01", to: "2022-12-31" });
  assert.deepEqual(parseLegacyFilename("DECSTK22"), { kind: "stock", label: "DEC 2022", from: "2022-12-01", to: "2022-12-31" });
  assert.deepEqual(parseLegacyFilename("PURCH25.DBF"), { kind: "purchases", label: "2025", from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(parseLegacyFilename("RECPT26.DBF"), { kind: "receipts", label: "2026", from: "2026-01-01", to: "2026-12-31" });
  assert.equal(parseLegacyFilename("recpt27.dbf")?.from, "2027-01-01");
  assert.equal(parseLegacyFilename("FEBBIL24.DBF")?.to, "2024-02-29");
  assert.equal(parseLegacyFilename("MARBIL99.DBF")?.from, "1999-03-01");
  for (const bad of ["ANOVBIL25.DBF", "BILSEK25.DBF", "XXXBIL25.DBF", "DECBIL2025.DBF", "PURCH.DBF", "../DECBIL25.DBF"]) {
    assert.equal(parseLegacyFilename(bad), null, bad);
  }
});

test("a preview changes nothing", async () => {
  clearData();
  const report = await preview("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1), billRow(2)]));
  assert.equal(report.kind, "sales");
  assert.equal(report.period, "DEC 2025");
  assert.equal(report.to_import, 2);
  assert.equal(report.to_import_amount, 2000);
  assert.equal(count("bills"), 0);
  assert.equal(count("vehicles WHERE vehicle_no = 'TN01AB1234'"), 0);
});

test("sales lines become bills with the source's figures", async () => {
  clearData();
  const report = await commit(
    "DECBIL25.DBF",
    dbf(BILL_FIELDS, [
      billRow(1),
      billRow(1, { ICODE: "HSD", QTY: 5, RATE: 90, AMT: 450, TAX_AMT: 68.64, BTIME: "10:00:01" }),
      // Same number and time, other counter: a different sale.
      billRow(1, { STATUS: "C", VEH_NO: "TN02", CUST_CODE: "C01", QTY: 2, AMT: 200, TAX_AMT: 30, BTIME: "10:00:01" }),
    ]),
  );
  assert.equal(report.imported, true);
  assert.equal(report.to_import, 2);
  assert.equal(report.to_import_lines, 3);
  const bills = db.prepare("SELECT * FROM bills ORDER BY grand_total DESC").all() as unknown as Record<string, unknown>[];
  assert.equal(bills.length, 2);
  assert.equal(bills[0].grand_total, 1450);
  assert.equal(bills[0].tax_total, 218.64);
  assert.equal(bills[0].sub_total, 1231.36);
  assert.equal(bills[0].bill_date, "2025-12-05 10:00:01");
  assert.equal(bills[0].payment_type, "cash");
  assert.equal(bills[0].user_id, "kp");
  assert.equal(bills[1].payment_type, "credit");
  assert.deepEqual([bills[0].legacy_bill_no, bills[1].legacy_bill_no], [1, 1], "Petbill's number is kept");
  assert.equal(bills[1].customer_code, "C01");
  const line = db.prepare("SELECT * FROM bill_lines WHERE item_code = 'HSD'").get() as Record<string, unknown>;
  assert.equal(line.qty, 5);
  assert.equal(line.rate_pretax, 85);
  assert.equal(line.tax_amount, 68.64);
});

test("history posts nothing onward: no dues and no stock", async () => {
  clearData();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1, { CUST_CODE: "C01" })]));
  assert.equal((db.prepare("SELECT due_amount FROM customers WHERE code = 'C01'").get() as { due_amount: number }).due_amount, 0);
  assert.equal(count("stock_daybook"), 0);
});

test("uploading again only adds what's new", async () => {
  clearData();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1), billRow(2)]));
  const nothing = await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1), billRow(2)]));
  assert.equal(nothing.imported, false);
  assert.equal(nothing.to_import, 0);
  assert.equal(nothing.already_present, 2);
  assert.equal(count("bills"), 2);

  const grown = await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1), billRow(2), billRow(3)]));
  assert.equal(grown.to_import, 1);
  assert.equal(grown.already_present, 2);
  assert.equal(count("bills"), 3);
});

test("two genuinely identical sales both count, once each", async () => {
  clearData();
  const twins = dbf(BILL_FIELDS, [billRow(7, { BTIME: "11:11:11" }), billRow(8, { BTIME: "11:11:11" })]);
  assert.equal((await commit("DECBIL25.DBF", twins)).to_import, 2);
  assert.equal((await commit("DECBIL25.DBF", twins)).to_import, 0);
  assert.equal(count("bills"), 2);

  // One of the pair already here, from a copy of the file taken between them.
  clearData();
  assert.equal((await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(7, { BTIME: "11:11:11" })]))).to_import, 1);
  const report = await commit("DECBIL25.DBF", twins);
  assert.equal(report.to_import, 1);
  assert.equal(report.already_present, 1);
  assert.equal(count("bills"), 2);
});

test("data from the earlier command-line import isn't duplicated, and a cancelled bill stays cancelled", async () => {
  clearData();
  const made = db
    .prepare(
      `INSERT INTO bills (bill_date, vehicle_no, sub_total, tax_total, grand_total, payment_type, status)
       VALUES ('2025-12-05 10:00:01', NULL, 850, 150, 1000, 'cash', 'cancelled')`,
    )
    .run();
  db.prepare(
    `INSERT INTO bill_lines (bill_no, item_code, qty, rate, rate_pretax, amount, tax_percent, tax_amount)
     VALUES (?, 'MS', 10, 100, 85, 1000, 18, 150)`,
  ).run(made.lastInsertRowid);
  const report = await preview("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1, { VEH_NO: "" })]));
  assert.equal(report.to_import, 0);
  assert.equal(report.already_present, 1);
});

test("a bill with an unknown item is held whole, not imported short", async () => {
  clearData();
  const report = await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1), billRow(1, { ICODE: "ZZZ" }), billRow(2)]));
  assert.equal(report.to_import, 1);
  const skip = report.skipped.find((s) => s.reason.includes("Catalog"));
  assert.equal(skip?.count, 1);
  assert.deepEqual(skip?.examples, ["ZZZ"]);
  assert.equal(count("bills"), 1);
  assert.equal(count("bill_lines"), 1);
});

test("a bill with an unknown customer is held, not passed off as cash, and comes in once the customer exists", async () => {
  clearData();
  const file = dbf(BILL_FIELDS, [billRow(1, { CUST_CODE: "C99" })]);
  const held = await commit("DECBIL25.DBF", file);
  assert.equal(held.to_import, 0);
  assert.deepEqual(held.skipped.find((s) => s.reason.includes("Customers"))?.examples, ["C99"]);
  assert.equal(count("bills"), 0);

  db.exec("INSERT INTO customers (code, name) VALUES ('C99', 'Late Co')");
  assert.equal((await commit("DECBIL25.DBF", file)).to_import, 1);
  assert.equal((db.prepare("SELECT payment_type FROM bills").get() as { payment_type: string }).payment_type, "credit");
});

test("an unknown cashier is shown as a note, and new vehicles are added on import only", async () => {
  clearData();
  const file = dbf(BILL_FIELDS, [billRow(1, { USER_ID: "gone", VEH_NO: "KA09NEW" })]);
  const report = await preview("DECBIL25.DBF", file);
  assert.ok(report.notes.some((n) => n.includes("cashier")));
  assert.ok(report.notes.some((n) => n.includes("vehicle")));
  assert.equal(count("vehicles WHERE vehicle_no = 'KA09NEW'"), 0);
  await commit("DECBIL25.DBF", file);
  assert.equal((db.prepare("SELECT user_id FROM bills").get() as { user_id: string | null }).user_id, null);
  assert.equal(count("vehicles WHERE vehicle_no = 'KA09NEW'"), 1);
});

test("values FoxPro overflowed, blank figures, deleted rows and rows from other months stay out", async () => {
  clearData();
  const report = await commit(
    "DECBIL25.DBF",
    dbf(
      BILL_FIELDS,
      [
        billRow(1, { AMT: "*".repeat(10) }),
        billRow(2, { QTY: null }),
        billRow(3, { BILL_DATE: "2025-11-30" }),
        billRow(0),
        billRow(4),
      ],
      [billRow(5)],
    ),
  );
  assert.equal(report.rows, 5);
  assert.equal(report.to_import, 1);
  assert.equal(report.skipped.find((s) => s.reason.includes("unreadable"))?.count, 2);
  assert.deepEqual(report.skipped.find((s) => s.reason.includes("outside"))?.examples, ["2025-11-30"]);
  assert.equal(report.skipped.find((s) => s.reason.includes("no bill number"))?.count, 1);
  assert.equal(count("bills"), 1);
});

test("a file with no tax columns says so instead of inventing tax", async () => {
  clearData();
  const fields = BILL_FIELDS.filter(([name]) => !["RATEBTX", "TAX_PER", "TAX_AMT"].includes(name));
  const report = await commit("MARBIL02.DBF", dbf(fields, [billRow(1, { BILL_DATE: "2002-03-04" })]));
  assert.ok(report.notes.some((n) => n.includes("no tax columns")));
  const bill = db.prepare("SELECT sub_total, tax_total, grand_total FROM bills").get() as Record<string, number>;
  assert.deepEqual({ ...bill }, { sub_total: 1000, tax_total: 0, grand_total: 1000 });
  const line = db.prepare("SELECT rate_pretax FROM bill_lines").get() as { rate_pretax: number };
  assert.equal(line.rate_pretax, 100);
});

test("files that can't be trusted are blocked whole", async () => {
  clearData();
  const good = dbf(BILL_FIELDS, [billRow(1), billRow(2)]);
  const cases: [string, string, Buffer][] = [
    ["a stale copy", "ANOVBIL25.DBF", good],
    ["not a table", "DECBIL25.DBF", Buffer.from("this is not a dbf file at all, just some text that is long enough to pass")],
    ["too short", "DECBIL25.DBF", Buffer.from("x")],
    ["cut short", "DECBIL25.DBF", good.subarray(0, good.length - 120)],
    ["the wrong month", "NOVBIL25.DBF", good],
    ["the wrong year", "DECBIL19.DBF", good],
    ["stock columns in a sales name", "DECBIL25.DBF", dbf(STOCK_FIELDS, [{ ICODE: "MS", SDATE: "2025-12-01" }])],
  ];
  for (const [label, name, content] of cases) {
    const report = await preview(name, content);
    assert.ok(report.blocked, label);
    assert.equal(report.to_import, 0, label);
    const res = await send("commit", name, content);
    assert.equal(res.statusCode, 422, label);
  }
  assert.equal(count("bills"), 0);
  assert.equal(count("audit_logs WHERE action = 'legacy_import' AND entity_id = 'NOVBIL25.DBF'"), 0);
  assert.ok((await preview("RECPT26.DBF", good)).blocked?.includes("receipts file"));
});

test("an empty file is fine, not an error", async () => {
  clearData();
  const report = await commit("PURCH26.DBF", dbf(PURCHASE_FIELDS, []));
  assert.equal(report.blocked, null);
  assert.equal(report.to_import, 0);
  assert.equal(report.imported, false);
});

test("a missing or wrong body is refused", async () => {
  const res = await app.inject({ method: "POST", url: "/legacy-import/preview?filename=DECBIL25.DBF", headers: { authorization: `Bearer ${superToken}` } });
  assert.equal(res.statusCode, 400);
  assert.equal((await send("preview", "", dbf(BILL_FIELDS, []))).statusCode, 400);
});

function stockRow(date: string, item = "MS", overrides: Row = {}): Row {
  return { ICODE: item, SDATE: date, OSTOCK: 100, CSTOCK: 80, RECEIPTS: 5, DAMAGED: 1, SALES: 24, BALANCE: 80, ...overrides };
}

test("stock rows are imported closed, and uploading again adds only the missing ones", async () => {
  clearData();
  const report = await commit("DECSTK22.DBF", dbf(STOCK_FIELDS, [stockRow("2022-12-01"), stockRow("2022-12-01", "HSD"), stockRow("2022-11-30"), stockRow("2022-12-01", "ZZZ")]));
  assert.equal(report.to_import, 2);
  assert.equal(report.skipped.find((s) => s.reason.includes("outside"))?.count, 1);
  assert.deepEqual(report.skipped.find((s) => s.reason.includes("Catalog"))?.examples, ["ZZZ"]);
  const row = db.prepare("SELECT * FROM stock_daybook WHERE item_code = 'MS'").get() as Record<string, number>;
  assert.deepEqual(
    [row.opening, row.receipts, row.damaged, row.sales, row.closing, row.balance, row.closed],
    [100, 5, 1, 24, 80, 80, 1],
  );

  const again = await commit("DECSTK22.DBF", dbf(STOCK_FIELDS, [stockRow("2022-12-01"), stockRow("2022-12-01", "HSD"), stockRow("2022-12-02")]));
  assert.equal(again.to_import, 1);
  assert.equal(again.already_present, 2);
});

test("stock can't close the day billing is using, or a later one", async () => {
  clearData();
  const today = todayDateOnly();
  const file = `${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(today.slice(5, 7)) - 1]}STK${today.slice(2, 4)}.DBF`;
  const report = await commit(file, dbf(STOCK_FIELDS, [stockRow(today)]));
  assert.equal(report.to_import, 0);
  assert.ok(report.skipped.some((s) => s.reason.includes("business date")));
  assert.equal(count("stock_daybook WHERE closed = 1"), 0);
  stockRepo.applySale("MS", 1, today); // throws if the day were closed
});

test("a past day PetroPro left open keeps its live figures", async () => {
  clearData();
  db.exec("INSERT INTO stock_daybook (item_code, sdate, opening, closing, balance, closed) VALUES ('MS', '2022-12-10', 1, 2, 3, 0)");
  const report = await commit("DECSTK22.DBF", dbf(STOCK_FIELDS, [stockRow("2022-12-10"), stockRow("2022-12-10", "HSD"), stockRow("2022-12-11")]));
  assert.equal(report.to_import, 1);
  assert.equal(report.skipped.find((s) => s.reason.includes("hasn't closed"))?.count, 2);
  const live = db.prepare("SELECT opening, closed FROM stock_daybook WHERE sdate = '2022-12-10'").all() as unknown as Record<string, number>[];
  assert.deepEqual(live.map((r) => ({ ...r })), [{ opening: 1, closed: 0 }]);
});

function purchaseRow(date: string, overrides: Row = {}): Row {
  return { ICODE: "MS", QTY: 1000, INVNO: 55, PUR_VALUE: 90000, PUR_DATE: date, VAT_AMT: 0, ...overrides };
}

test("purchases start from the last one in PetroPro", async () => {
  clearData();
  const first = await commit("PURCH25.DBF", dbf(PURCHASE_FIELDS, [purchaseRow("2025-02-01"), purchaseRow("2025-03-01", { INVNO: 56 })]));
  assert.equal(first.to_import, 2);
  assert.ok(first.notes[0].includes("no purchases yet"));

  const next = await commit(
    "PURCH25.DBF",
    dbf(PURCHASE_FIELDS, [
      purchaseRow("2025-02-01"),
      purchaseRow("2025-03-01", { INVNO: 56 }),
      purchaseRow("2025-03-01", { INVNO: 57 }), // same day as the last, not seen before
      purchaseRow("2025-04-01", { INVNO: 58, VAT_AMT: 12.5 }),
    ]),
  );
  assert.equal(next.to_import, 2);
  assert.equal(next.already_present, 1);
  assert.equal(next.skipped.find((s) => s.reason.includes("older"))?.count, 1);
  assert.ok(next.notes[0].includes("2025-03-01"));
  assert.equal(count("purchases"), 4);
  const row = db.prepare("SELECT * FROM purchases WHERE invoice_no = '58'").get() as Record<string, unknown>;
  assert.deepEqual([row.pur_date, row.qty, row.value, row.vat_amount], ["2025-04-01", 1000, 90000, 12.5]);

  assert.equal((await commit("PURCH25.DBF", dbf(PURCHASE_FIELDS, [purchaseRow("2025-04-01", { INVNO: 58, VAT_AMT: 12.5 })]))).to_import, 0);
});

test("purchases don't touch stock or the item's cost, and stay inside the file's year", async () => {
  clearData();
  const before = db.prepare("SELECT * FROM items WHERE code = 'MS'").get();
  const report = await commit("PURCH25.DBF", dbf(PURCHASE_FIELDS, [purchaseRow("2025-05-01"), purchaseRow("2024-12-31"), purchaseRow("2025-05-02", { INVNO: 0 })]));
  assert.equal(report.to_import, 2);
  assert.equal(report.skipped.find((s) => s.reason.includes("outside"))?.count, 1);
  assert.equal(count("stock_daybook"), 0);
  assert.deepEqual(db.prepare("SELECT * FROM items WHERE code = 'MS'").get(), before);
  assert.equal(count("purchases WHERE invoice_no IS NULL"), 1);
});

const RECEIPT_FIELDS: Field[] = [
  ["REC_NO", "N", 10],
  ["REC_DATE", "D", 8],
  ["CUST_CODE", "C", 5],
  ["CSHORCHQ", "C", 2],
  ["CHQNO", "N", 10],
  ["BANKNAME", "C", 25],
  ["AMOUNT", "N", 10, 2],
  ["SC_AMT", "N", 10, 2],
  ["REC_TIME", "C", 8],
  ["CSR_INIT", "C", 3],
];

function receiptRow(date: string, overrides: Row = {}): Row {
  return { REC_NO: 1, REC_DATE: date, CUST_CODE: "C01", CSHORCHQ: "CA", CHQNO: 0, BANKNAME: "", AMOUNT: 5000, SC_AMT: 0, REC_TIME: "10:00:00", CSR_INIT: "kp", ...overrides };
}

test("receipts come in with their cheque details and reach the customer's ledger", async () => {
  clearData();
  const report = await commit(
    "RECPT26.DBF",
    dbf(RECEIPT_FIELDS, [receiptRow("2026-01-10"), receiptRow("2026-02-10", { CSHORCHQ: "CQ", CHQNO: 445566, BANKNAME: "SBI", AMOUNT: 7500.5, SC_AMT: 12.5 })]),
  );
  assert.equal(report.kind, "receipts");
  assert.equal(report.to_import, 2);
  assert.equal(report.to_import_amount, 12500.5);
  assert.ok(report.notes.some((n) => n.includes("CA")));

  const rows = db.prepare("SELECT * FROM receipts ORDER BY rec_date").all() as unknown as Record<string, unknown>[];
  assert.deepEqual(
    [rows[0].rec_date, rows[0].customer_code, rows[0].amount, rows[0].mode, rows[0].cheque_no, rows[0].bank_name, rows[0].cashier_id],
    ["2026-01-10", "C01", 5000, "cash", null, null, "kp"],
  );
  assert.deepEqual(
    [rows[1].mode, rows[1].cheque_no, rows[1].bank_name, rows[1].service_charge, rows[1].amount],
    ["cheque", "445566", "SBI", 12.5, 7500.5],
  );

  const entries = getCustomerLedger("C01");
  assert.ok(JSON.stringify(entries).includes("7500.5"), "the ledger shows the receipt");
});

test("receipts don't change dues, and uploading again only adds what's new, whatever the date", async () => {
  clearData();
  const jan = receiptRow("2026-01-10");
  const mar = receiptRow("2026-03-10", { AMOUNT: 100 });
  await commit("RECPT26.DBF", dbf(RECEIPT_FIELDS, [mar]));
  assert.equal((db.prepare("SELECT due_amount FROM customers WHERE code = 'C01'").get() as { due_amount: number }).due_amount, 0);

  // January was entered late in Petbill, so it's older than what's here and still has to arrive.
  const next = await commit("RECPT26.DBF", dbf(RECEIPT_FIELDS, [jan, mar]));
  assert.equal(next.to_import, 1);
  assert.equal(next.already_present, 1);
  assert.equal(count("receipts"), 2);
  assert.equal((await commit("RECPT26.DBF", dbf(RECEIPT_FIELDS, [jan, mar]))).to_import, 0);

  // Two identical receipts on one day are two receipts.
  const twin = await commit("RECPT26.DBF", dbf(RECEIPT_FIELDS, [jan, jan, mar]));
  assert.equal(twin.to_import, 1);
  assert.equal(count("receipts"), 3);
});

test("a receipt entered live with a time isn't imported twice", async () => {
  clearData();
  db.exec("INSERT INTO receipts (rec_date, customer_code, amount, mode) VALUES ('2026-01-10 09:30:00', 'C01', 5000, 'cash')");
  const report = await preview("RECPT26.DBF", dbf(RECEIPT_FIELDS, [receiptRow("2026-01-10")]));
  assert.equal(report.to_import, 0);
  assert.equal(report.already_present, 1);
});

test("receipts that can't be placed are held and reported", async () => {
  clearData();
  const report = await commit(
    "RECPT26.DBF",
    dbf(RECEIPT_FIELDS, [
      receiptRow("2026-01-10", { CUST_CODE: "C77" }),
      receiptRow("2026-01-11", { CUST_CODE: "" }),
      receiptRow("2026-01-12", { AMOUNT: "*".repeat(10) }),
      receiptRow("2026-01-13", { AMOUNT: null }),
      receiptRow("2025-12-31"),
      receiptRow("2026-01-14", { CSR_INIT: "ZZ" }),
    ]),
  );
  assert.equal(report.to_import, 1);
  assert.deepEqual(report.skipped.find((s) => s.reason.includes("Customers"))?.examples, ["C77", "(blank)"]);
  assert.equal(report.skipped.find((s) => s.reason.includes("unreadable"))?.count, 2);
  assert.deepEqual(report.skipped.find((s) => s.reason.includes("outside"))?.examples, ["2025-12-31"]);
  assert.ok(report.notes.some((n) => n.includes("cashier")));
  assert.equal((db.prepare("SELECT cashier_id FROM receipts").get() as { cashier_id: string | null }).cashier_id, null);
});

const MAGE_FIELDS: Field[] = [
  ["BILL_NO", "N", 10],
  ["STATUS", "C", 1],
  ["VEH_NO", "C", 13],
  ["ICODE", "C", 3],
  ["OR", "N", 9, 1],
  ["CR", "N", 9, 1],
  ["MILEAGE", "N", 6, 2],
];

function mageRow(no: number, overrides: Row = {}): Row {
  return { BILL_NO: no, STATUS: "R", VEH_NO: "TN01AB1234", ICODE: "MS", OR: 1000, CR: 1120.5, MILEAGE: 12.05, ...overrides };
}

const mileageOf = (billNo: number) => db.prepare("SELECT * FROM mileage_log WHERE bill_no = ? ORDER BY id").all(billNo) as unknown as Record<string, unknown>[];
const billNoFor = (legacyNo: number, status = "R") => (db.prepare("SELECT bill_no FROM bills WHERE legacy_bill_no = ? AND legacy_status = ?").get(legacyNo, status) as { bill_no: number }).bill_no;

function clearMileage() {
  db.exec("DELETE FROM mileage_log");
  clearData();
  db.exec("UPDATE items SET track_mileage = 0");
  db.exec("UPDATE items SET track_mileage = 1 WHERE code IN ('MS', 'HSD')");
}

test("MAGE's name means a financial year, unlike the other files", () => {
  assert.deepEqual(parseLegacyFilename("MAGE25.DBF"), { kind: "mileage", label: "FY 2025-26", from: "2025-04-01", to: "2026-03-31" });
  assert.equal(parseLegacyFilename("mage18")?.to, "2019-03-31");
});

test("readings attach to the imported bill, including one from the next calendar year", async () => {
  clearMileage();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1, { CUST_CODE: "C01" })]));
  await commit("MARBIL26.DBF", dbf(BILL_FIELDS, [billRow(2, { CUST_CODE: "C01", BILL_DATE: "2026-03-10" })]));
  const report = await commit("MAGE25.DBF", dbf(MAGE_FIELDS, [mageRow(1), mageRow(2, { OR: 1120.5, CR: 1300, MILEAGE: 17.95 })]));
  assert.equal(report.kind, "mileage");
  assert.equal(report.period, "FY 2025-26");
  assert.equal(report.to_import, 2);
  assert.equal(report.imported, true);
  const [first] = mileageOf(billNoFor(1));
  assert.deepEqual([first.vehicle_no, first.item_code, first.odometer_prev, first.odometer_curr, first.qty, first.mileage], ["TN01AB1234", "MS", 1000, 1120.5, 10, 12.05]);
  assert.equal(mileageOf(billNoFor(2))[0].odometer_curr, 1300);
});

test("Petbill's doubled rows count once, and uploading again adds nothing", async () => {
  clearMileage();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1)]));
  const file = dbf(MAGE_FIELDS, [mageRow(1), mageRow(1)]);
  const report = await commit("MAGE25.DBF", file);
  assert.equal(report.to_import, 1);
  assert.ok(report.notes.some((n) => n.includes("1 repeated row")));
  assert.equal(mileageOf(billNoFor(1)).length, 1);
  const again = await commit("MAGE25.DBF", file);
  assert.equal(again.to_import, 0);
  assert.equal(again.already_present, 1);
  assert.equal(mileageOf(billNoFor(1)).length, 1);
});

test("a preview writes nothing", async () => {
  clearMileage();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1)]));
  assert.equal((await preview("MAGE25.DBF", dbf(MAGE_FIELDS, [mageRow(1)]))).to_import, 1);
  assert.equal(count("mileage_log"), 0);
});

test("a cash and a credit bill can share a number, and each gets its own reading", async () => {
  clearMileage();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(5, { STATUS: "C", BTIME: "09:00:00" }), billRow(5, { STATUS: "R", CUST_CODE: "C01", BTIME: "10:00:00" })]));
  await commit("MAGE25.DBF", dbf(MAGE_FIELDS, [mageRow(5, { STATUS: "C", CR: 500 }), mageRow(5, { STATUS: "R", CR: 900 })]));
  assert.equal(mileageOf(billNoFor(5, "C"))[0].odometer_curr, 500);
  assert.equal(mileageOf(billNoFor(5, "R"))[0].odometer_curr, 900);
});

test("a bill imported before this release has no status, and is matched by its payment type", async () => {
  clearMileage();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(6, { STATUS: "C", BTIME: "09:00:00" }), billRow(6, { STATUS: "R", CUST_CODE: "C01", BTIME: "10:00:00" })]));
  db.exec("UPDATE bills SET legacy_status = NULL");
  await commit("MAGE25.DBF", dbf(MAGE_FIELDS, [mageRow(6, { STATUS: "R", CR: 900 })]));
  const credit = db.prepare("SELECT bill_no FROM bills WHERE legacy_bill_no = 6 AND payment_type = 'credit'").get() as { bill_no: number };
  assert.equal(mileageOf(credit.bill_no)[0].odometer_curr, 900);
  assert.equal(count("mileage_log"), 1);
});

test("a reading naming another item on the bill still lands on the fuel line", async () => {
  clearMileage();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(7), billRow(7, { ICODE: "L99", QTY: 1, AMT: 50 })]));
  db.exec("INSERT OR IGNORE INTO items (code, name) VALUES ('L99', 'Cloth')");
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(7), billRow(7, { ICODE: "L99", QTY: 1, AMT: 50 })]));
  await commit("MAGE25.DBF", dbf(MAGE_FIELDS, [mageRow(7, { ICODE: "L99" })]));
  const [row] = mileageOf(billNoFor(7));
  assert.deepEqual([row.item_code, row.qty], ["MS", 10]);
});

test("rows that lead nowhere are reported, never guessed", async () => {
  clearMileage();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1)]));
  const report = await commit(
    "MAGE25.DBF",
    dbf(MAGE_FIELDS, [
      mageRow(99),
      mageRow(1, { VEH_NO: "OTHER" }),
      mageRow(1, { CR: 0, OR: 0, MILEAGE: 0 }),
      mageRow(1, { CR: "*".repeat(9) }),
    ]),
  );
  assert.equal(report.to_import, 0);
  assert.deepEqual(report.skipped.find((s) => s.reason.includes("not in PetroPro"))?.examples, ["Bill 99"]);
  assert.equal(report.skipped.find((s) => s.reason.includes("vehicle differs"))?.count, 1);
  assert.equal(report.skipped.find((s) => s.reason.includes("unreadable"))?.count, 1);
  assert.ok(report.notes.some((n) => n.includes("1 row(s) with no reading")));
  assert.equal(count("mileage_log"), 0);
});

test("two bills with one number in a year are held rather than guessed", async () => {
  clearMileage();
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1)]));
  await commit("JANBIL26.DBF", dbf(BILL_FIELDS, [billRow(1, { BILL_DATE: "2026-01-05" })]));
  const report = await commit("MAGE25.DBF", dbf(MAGE_FIELDS, [mageRow(1)]));
  assert.equal(report.skipped.find((s) => s.reason.includes("more than one"))?.count, 1);
  assert.equal(count("mileage_log"), 0);
});

test("the financial year keeps a number from matching another year's bill", async () => {
  clearMileage();
  await commit("DECBIL24.DBF", dbf(BILL_FIELDS, [billRow(1, { BILL_DATE: "2024-12-05" })]));
  const report = await commit("MAGE25.DBF", dbf(MAGE_FIELDS, [mageRow(1)]));
  assert.equal(report.to_import, 0);
  assert.equal(report.skipped.find((s) => s.reason.includes("not in PetroPro"))?.count, 1);
  assert.equal(count("mileage_log"), 0);
});

test("a MAGE file with the wrong columns is blocked", async () => {
  const report = await preview("MAGE25.DBF", dbf(STOCK_FIELDS, [{ ICODE: "MS", SDATE: "2025-12-01" }]));
  assert.match(report.blocked ?? "", /mileage file/);
});

test("old readings imported later don't become a vehicle's starting point", async () => {
  clearMileage();
  const { mileageRepo } = await import("../repositories/mileage.js");
  const live = db.prepare("INSERT INTO bills (bill_date, vehicle_no, grand_total, payment_type) VALUES ('2026-11-01 10:00:00', 'TN01AB1234', 100, 'cash')").run();
  mileageRepo.record({ billNo: Number(live.lastInsertRowid), vehicleNo: "TN01AB1234", itemCode: "MS", odometerOpening: 5000, odometerCurr: 5500, qty: 10 });
  await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1)]));
  await commit("MAGE25.DBF", dbf(MAGE_FIELDS, [mageRow(1, { OR: 1000, CR: 1120.5 })]));
  const next = db.prepare("INSERT INTO bills (bill_date, vehicle_no, grand_total, payment_type) VALUES ('2026-11-02 10:00:00', 'TN01AB1234', 100, 'cash')").run();
  const entry = mileageRepo.record({ billNo: Number(next.lastInsertRowid), vehicleNo: "TN01AB1234", itemCode: "MS", odometerCurr: 5600, qty: 10 });
  assert.equal(entry.odometer_prev, 5500, "the live reading, not the older imported one");
  assert.equal(entry.mileage, 10);
});

test("an import takes a backup when asked, and is audited without customer details", async () => {
  clearData();
  const backupsBefore = listBackups().length;
  const report = await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1, { CUST_CODE: "C01" })]), "&backup=1");
  assert.ok(report.backup);
  assert.equal(listBackups().length, backupsBefore + 1);
  const log = db
    .prepare("SELECT * FROM audit_logs WHERE action = 'legacy_import' ORDER BY id DESC LIMIT 1")
    .get() as { user_id: string; entity_id: string; details: string };
  assert.equal(log.user_id, "boss");
  assert.equal(log.entity_id, "DECBIL25.DBF");
  assert.equal(JSON.parse(log.details).imported, 1);
  assert.equal(JSON.parse(log.details).backup, report.backup);
  assert.ok(!log.details.includes("C01") && !log.details.includes("TN01"));

  // Nothing to do means no backup taken and nothing recorded.
  const audits = count("audit_logs WHERE action = 'legacy_import'");
  assert.equal((await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1, { CUST_CODE: "C01" })]), "&backup=1")).backup, null);
  assert.equal(listBackups().length, backupsBefore + 1);
  assert.equal(count("audit_logs WHERE action = 'legacy_import'"), audits);
});

test("a failure part-way leaves the file's data out entirely", async () => {
  clearData();
  db.exec(`CREATE TRIGGER fail_second_bill BEFORE INSERT ON bill_lines WHEN NEW.qty = 99 BEGIN SELECT RAISE(ABORT, 'boom'); END`);
  try {
    const res = await send("commit", "DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1), billRow(2, { QTY: 99 })]));
    assert.equal(res.statusCode, 500);
    assert.equal(count("bills"), 0);
    assert.equal(count("bill_lines"), 0);
  } finally {
    db.exec("DROP TRIGGER fail_second_bill");
  }
  assert.equal((await commit("DECBIL25.DBF", dbf(BILL_FIELDS, [billRow(1)]))).to_import, 1);
});
