#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "../db/client.js";
import { itemsRepo } from "../repositories/items.js";
import { customersRepo } from "../repositories/customers.js";
import { usersRepo } from "../repositories/users.js";
import { vehiclesRepo } from "../repositories/vehicles.js";
import { purchasesRepo } from "../repositories/purchases.js";
import { readDbfRows, type DbfRow } from "./reader.js";

/**
 * Migrates a full fiscal year of REAL legacy transactional data (bills, stock day-book,
 * purchases, receipts, mileage) — 2025-04-01 through the legacy system's own "business date"
 * (`DATESTAT.DBF`'s `DATEHLD` in the target folder), read dynamically so a later re-run against
 * an updated folder/DATESTAT picks up new months automatically. See docs/MIGRATION_NOTES.md for
 * the full write-up of what this took to get right (BILSEK/MAGE mileage-routing, the ANOVBIL25
 * gotcha, why STATUS isn't payment type) — run `import:legacy` (master data) against this same
 * folder first, this depends on customers/items/vehicles/users already existing.
 *
 * Unlike importTransactions.ts's single fixed 3-month demo window, this spans up to 12 monthly
 * files and is idempotent **per month** (checked against each month's actual bill-date range),
 * not one all-or-nothing guard — so it can be safely re-run as new months are added upstream.
 */

const workareaDir = process.argv[2] ?? path.resolve(process.cwd(), "..", "..", "legacy", "Workarea");
const WINDOW_FROM = "2025-04-01";

interface ImportSummary {
  table: string;
  totalRows: number;
  imported: number;
  skippedExisting: number;
  skippedInvalid: number;
}

function str(row: DbfRow, key: string): string {
  const v = row[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

function num(row: DbfRow, key: string): number {
  const v = row[key];
  return typeof v === "number" ? v : 0;
}

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

interface MonthPlan {
  calendarMonth: number; // 1-12
  calendarYear: number;
  label: string;
  billFile: string;
  stockFile: string;
}

/** `<MON><YY>` uses a plain calendar-year suffix for BIL/STK files (confirmed by reading actual
 *  BILL_DATE/SDATE values — e.g. JANBIL26.DBF really is January 2026, not fiscal-year-relative).
 *  This is a *different* convention from BILSEK/MAGE below, which are fiscal-year-numbered. */
function buildMonthPlan(from: string, to: string): MonthPlan[] {
  const months: MonthPlan[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const toY = Number(to.slice(0, 4));
  const toM = Number(to.slice(5, 7));
  while (y < toY || (y === toY && m <= toM)) {
    const yearSuffix = String(y).slice(-2);
    const abbr = MONTH_ABBR[m - 1];
    months.push({
      calendarMonth: m,
      calendarYear: y,
      label: `${y}-${String(m).padStart(2, "0")}`,
      billFile: `${abbr}BIL${yearSuffix}.DBF`,
      stockFile: `${abbr}STK${yearSuffix}.DBF`,
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

function readWindowTo(): string {
  const datestatPath = path.join(workareaDir, "DATESTAT.DBF");
  for (const row of readDbfRows(datestatPath)) {
    const v = row.DATEHLD;
    if (typeof v === "string" && v) return v;
  }
  throw new Error(`DATESTAT.DBF (${datestatPath}) has no usable DATEHLD value`);
}

function billsExistInRange(from: string, to: string): boolean {
  return !!db.prepare("SELECT 1 FROM bills WHERE date(bill_date) BETWEEN ? AND ? LIMIT 1").get(from, to);
}

interface MileageCandidate {
  billNo: number;
  status: string;
  vehicleNo: string;
  itemCode: string;
  qty: number;
  newBillNo: number;
}

/** Same (BILL_NO, BTIME) grouping fix the 2019 demo importer needed — BILL_NO alone repeats
 *  across unrelated transactions within one file. `status` is carried through per candidate
 *  since MAGE25.DBF rows need it too (see importMileage). */
function importBillFile(
  file: string,
  from: string,
  to: string,
  bills: ImportSummary,
  lines: ImportSummary,
  monthCandidates: MileageCandidate[],
): void {
  const rows = [...readDbfRows(path.join(workareaDir, file))].filter((r) => {
    const d = str(r, "BILL_DATE");
    return d >= from && d <= to;
  });
  lines.totalRows += rows.length;

  const byGroup = new Map<string, DbfRow[]>();
  for (const row of rows) {
    const billNo = num(row, "BILL_NO");
    if (!billNo) continue;
    const key = `${billNo}|${str(row, "BTIME")}`;
    const group = byGroup.get(key);
    if (group) group.push(row);
    else byGroup.set(key, [row]);
  }
  bills.totalRows += byGroup.size;

  const insertBill = db.prepare(
    `INSERT INTO bills (bill_date, vehicle_no, customer_code, user_id, sub_total, tax_total, grand_total, payment_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLine = db.prepare(
    `INSERT INTO bill_lines (bill_no, item_code, qty, rate, rate_pretax, amount, tax_percent, tax_amount, is_retail, service_charge)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const group of byGroup.values()) {
    const first = group[0];
    const legacyBillNo = num(first, "BILL_NO");
    const status = str(first, "STATUS");
    const rawDate = str(first, "BILL_DATE");
    if (!rawDate) {
      bills.skippedInvalid++;
      lines.skippedInvalid += group.length;
      continue;
    }
    const btime = str(first, "BTIME");
    const billDate = /^\d{2}:\d{2}:\d{2}$/.test(btime) ? `${rawDate} ${btime}` : `${rawDate} 00:00:00`;

    const vehicleNoRaw = str(first, "VEH_NO");
    const vehicleNo = vehicleNoRaw ? vehiclesRepo.findOrCreate(vehicleNoRaw).vehicle_no : null;

    const custCode = str(first, "CUST_CODE");
    const customerCode = custCode && customersRepo.get(custCode) ? custCode : null;

    const userId = str(first, "USER_ID");
    const validUserId = userId && usersRepo.getById(userId) ? userId : null;

    // STATUS ('C'/'R') is not payment type (a 'C' row can have a blank CUST_CODE) — it's which
    // of two independent BILL_NO counters assigned this bill (see BILSEK25.DBF / importMileage).
    const paymentType = customerCode ? "credit" : "cash";

    let subTotal = 0;
    let taxTotal = 0;
    const lineInputs: {
      item_code: string;
      qty: number;
      rate: number;
      rate_pretax: number;
      amount: number;
      tax_percent: number;
      tax_amount: number;
      is_retail: number;
      service_charge: number;
    }[] = [];

    for (const row of group) {
      const itemCode = str(row, "ICODE");
      if (!itemsRepo.get(itemCode)) {
        lines.skippedInvalid++;
        continue;
      }
      const amount = num(row, "AMT");
      const taxAmount = num(row, "TAX_AMT");
      lineInputs.push({
        item_code: itemCode,
        qty: num(row, "QTY"),
        rate: num(row, "RATE"),
        rate_pretax: num(row, "RATEBTX"),
        amount,
        tax_percent: num(row, "TAX_PER"),
        tax_amount: taxAmount,
        is_retail: num(row, "RETAIL") ? 1 : 0,
        service_charge: num(row, "SER_CHG"),
      });
      subTotal += amount - taxAmount;
      taxTotal += taxAmount;
    }
    if (lineInputs.length === 0) {
      bills.skippedInvalid++;
      continue;
    }

    const billResult = insertBill.run(
      billDate,
      vehicleNo,
      customerCode,
      validUserId,
      subTotal,
      taxTotal,
      subTotal + taxTotal,
      paymentType,
    );
    const newBillNo = Number(billResult.lastInsertRowid);
    bills.imported++;

    for (const line of lineInputs) {
      insertLine.run(
        newBillNo,
        line.item_code,
        line.qty,
        line.rate,
        line.rate_pretax,
        line.amount,
        line.tax_percent,
        line.tax_amount,
        line.is_retail,
        line.service_charge,
      );
      lines.imported++;
      if (vehicleNoRaw) {
        monthCandidates.push({ billNo: legacyBillNo, status, vehicleNo: vehicleNoRaw, itemCode: line.item_code, qty: line.qty, newBillNo });
      }
    }
  }
}

function importStockFile(file: string, from: string, to: string, summary: ImportSummary): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO stock_daybook (item_code, sdate, opening, receipts, damaged, sales, closing, balance, closed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  for (const row of readDbfRows(path.join(workareaDir, file))) {
    summary.totalRows++;
    const itemCode = str(row, "ICODE");
    const sdate = str(row, "SDATE");
    if (!itemCode || !sdate || sdate < from || sdate > to || !itemsRepo.get(itemCode)) {
      summary.skippedInvalid++;
      continue;
    }
    const result = insert.run(
      itemCode,
      sdate,
      num(row, "OSTOCK"),
      num(row, "RECEIPTS"),
      num(row, "DAMAGED"),
      num(row, "SALES"),
      num(row, "CSTOCK"),
      num(row, "BALANCE"),
    );
    if (result.changes > 0) summary.imported++;
    else summary.skippedExisting++;
  }
}

/** PURCH25.DBF/PURCH26.DBF are genuinely empty in this window (0 rows each) — expected, not a
 *  bug, matching the same "real dataset has zero X" pattern importTransactions.ts already hit
 *  for receipts in its 2019 window. Guarded coarsely (whole-window), same as receipts below. */
function importPurchasesWindow(from: string, to: string, summary: ImportSummary): void {
  if (db.prepare("SELECT 1 FROM purchases WHERE date(pur_date) BETWEEN ? AND ? LIMIT 1").get(from, to)) {
    console.log("  purchases already present for this window — skipping");
    return;
  }
  for (const file of ["PURCH25.DBF", "PURCH26.DBF"]) {
    const filePath = path.join(workareaDir, file);
    if (!fs.existsSync(filePath)) continue;
    for (const row of readDbfRows(filePath)) {
      summary.totalRows++;
      const itemCode = str(row, "ICODE");
      const purDate = str(row, "PUR_DATE");
      if (!itemCode || !purDate || !itemsRepo.get(itemCode) || purDate < from || purDate > to) {
        summary.skippedInvalid++;
        continue;
      }
      const invNo = num(row, "INVNO");
      purchasesRepo.create({
        item_code: itemCode,
        qty: num(row, "QTY"),
        value: num(row, "PUR_VALUE"),
        pur_date: purDate,
        invoice_no: invNo > 0 ? String(invNo) : null,
        vat_amount: num(row, "VAT_AMT"),
      });
      summary.imported++;
    }
  }
}

/** RECPT25.DBF has exactly 1 row in this window — inserted directly (not via receiptsRepo,
 *  whose ReceiptInput requires a non-null cashier_id; the real row's CSR_INIT is blank). */
function importReceiptsWindow(from: string, to: string, summary: ImportSummary): void {
  if (db.prepare("SELECT 1 FROM receipts WHERE date(rec_date) BETWEEN ? AND ? LIMIT 1").get(from, to)) {
    console.log("  receipts already present for this window — skipping");
    return;
  }
  const insert = db.prepare(
    `INSERT INTO receipts (rec_date, customer_code, amount, mode, cheque_no, bank_name, service_charge, cashier_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const file of ["RECPT25.DBF", "RECPT26.DBF"]) {
    const filePath = path.join(workareaDir, file);
    if (!fs.existsSync(filePath)) continue;
    for (const row of readDbfRows(filePath)) {
      summary.totalRows++;
      const custCode = str(row, "CUST_CODE");
      const recDate = str(row, "REC_DATE");
      if (!custCode || !recDate || !customersRepo.get(custCode) || recDate < from || recDate > to) {
        summary.skippedInvalid++;
        continue;
      }
      const mode = str(row, "CSHORCHQ").toUpperCase() === "CQ" ? "cheque" : "cash";
      const cashierId = str(row, "CSR_INIT");
      const validCashierId = cashierId && usersRepo.getById(cashierId) ? cashierId : null;
      insert.run(
        recDate,
        custCode,
        num(row, "AMOUNT"),
        mode,
        str(row, "CHQNO") || null,
        str(row, "BANKNAME") || null,
        num(row, "SC_AMT"),
        validCashierId,
      );
      summary.imported++;
    }
  }
}

interface BilsekRange {
  month: number;
  minBillNo: number;
  maxBillNo: number;
  status: string;
}

/** BILSEK25.DBF is the legacy system's own lookup index: BILL_NO is a year-wide counter split
 *  into two independent sequences by STATUS ('C'/'R'), and this table maps a (STATUS, BILL_NO)
 *  pair to exactly one calendar MONTH (1-12, where 1-3 = Jan-Mar 2026 at the tail of the FY).
 *  One file covers the whole fiscal year — no BILSEK26.DBF. Rows with a null MONTH are a
 *  separate running-total table, not per-month ranges — skipped. */
function loadBilsekRanges(): BilsekRange[] {
  const bilsekPath = path.join(workareaDir, "BILSEK25.DBF");
  if (!fs.existsSync(bilsekPath)) return [];
  const ranges: BilsekRange[] = [];
  for (const row of readDbfRows(bilsekPath)) {
    const month = row.MONTH;
    if (typeof month !== "number") continue;
    ranges.push({ month, minBillNo: num(row, "MINBILLNO"), maxBillNo: num(row, "MAXBILLNO"), status: str(row, "STATUS") });
  }
  return ranges;
}

/** MAGE25.DBF (BILL_NO, STATUS, VEH_NO, ICODE, OR, CR, MILEAGE) has no date field, so each row
 *  is routed to its month via BILSEK25.DBF first, then matched against that month's
 *  (BILL_NO, STATUS, VEH_NO, ICODE) candidates collected during importBillFile — the composite
 *  key needed because the two BILL_NO sequences ('C'/'R') can share a raw number within one
 *  month. Only months freshly imported *this run* have candidates available (see
 *  runFY2025Import) — a month already imported by a prior run won't get mileage re-attempted,
 *  a deliberate simplification for what's a one-off migration, not a recurring job. */
function importMileage(candidatesByMonth: Map<number, MileageCandidate[]>, summary: ImportSummary): void {
  const magePath = path.join(workareaDir, "MAGE25.DBF");
  if (!fs.existsSync(magePath)) return;
  const ranges = loadBilsekRanges();
  const insert = db.prepare(
    `INSERT INTO mileage_log (bill_no, vehicle_no, item_code, odometer_prev, odometer_curr, qty, mileage)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const row of readDbfRows(magePath)) {
    summary.totalRows++;
    const billNo = num(row, "BILL_NO");
    const status = str(row, "STATUS");
    const vehicleNo = str(row, "VEH_NO");
    const itemCode = str(row, "ICODE");

    const range = ranges.find((r) => r.status === status && billNo >= r.minBillNo && billNo <= r.maxBillNo);
    const candidates = range ? candidatesByMonth.get(range.month) : undefined;
    const match = candidates?.find(
      (c) => c.billNo === billNo && c.status === status && c.vehicleNo === vehicleNo && c.itemCode === itemCode,
    );
    if (!match) {
      summary.skippedInvalid++;
      continue;
    }

    insert.run(match.newBillNo, vehicleNo, itemCode, num(row, "OR") || null, num(row, "CR"), match.qty, num(row, "MILEAGE") || null);
    summary.imported++;
  }
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export interface FY2025ImportResult {
  windowFrom: string;
  windowTo: string;
  bills: ImportSummary;
  lines: ImportSummary;
  stock: ImportSummary;
  purchases: ImportSummary;
  receipts: ImportSummary;
  mileage: ImportSummary;
}

export function runFY2025Import(): FY2025ImportResult {
  const windowTo = readWindowTo();
  const months = buildMonthPlan(WINDOW_FROM, windowTo);

  const bills: ImportSummary = { table: "bills (FY2025)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const lines: ImportSummary = { table: "bill_lines (FY2025)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const stock: ImportSummary = { table: "stock_daybook (FY2025)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const purchases: ImportSummary = { table: "purchases (FY2025)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const receipts: ImportSummary = { table: "receipts (FY2025)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const mileage: ImportSummary = { table: "mileage_log (FY2025)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };

  const candidatesByMonth = new Map<number, MileageCandidate[]>();

  for (const plan of months) {
    const billPath = path.join(workareaDir, plan.billFile);
    if (!fs.existsSync(billPath)) {
      console.log(`  ${plan.label}: ${plan.billFile} not found — skipping`);
      continue;
    }

    const monthFrom = `${plan.calendarYear}-${String(plan.calendarMonth).padStart(2, "0")}-01`;
    const monthTo = `${plan.calendarYear}-${String(plan.calendarMonth).padStart(2, "0")}-${String(
      lastDayOfMonth(plan.calendarYear, plan.calendarMonth),
    ).padStart(2, "0")}`;
    const from = monthFrom > WINDOW_FROM ? monthFrom : WINDOW_FROM;
    const to = monthTo < windowTo ? monthTo : windowTo;

    if (billsExistInRange(from, to)) {
      console.log(`  ${plan.label}: bills already present — skipping`);
      continue;
    }

    const monthCandidates: MileageCandidate[] = [];
    db.exec("BEGIN");
    try {
      importBillFile(plan.billFile, from, to, bills, lines, monthCandidates);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    candidatesByMonth.set(plan.calendarMonth, monthCandidates);
    console.log(`  ${plan.label}: imported`);

    const stockPath = path.join(workareaDir, plan.stockFile);
    if (fs.existsSync(stockPath)) {
      db.exec("BEGIN");
      try {
        importStockFile(plan.stockFile, from, to, stock);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  importPurchasesWindow(WINDOW_FROM, windowTo, purchases);
  importReceiptsWindow(WINDOW_FROM, windowTo, receipts);
  importMileage(candidatesByMonth, mileage);

  return { windowFrom: WINDOW_FROM, windowTo, bills, lines, stock, purchases, receipts, mileage };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Importing FY2025 transactions from ${workareaDir}\n`);
  const result = runFY2025Import();
  console.log(`\nWindow: ${result.windowFrom} .. ${result.windowTo}`);
  for (const r of [result.bills, result.lines, result.stock, result.purchases, result.receipts, result.mileage]) {
    console.log(
      `${r.table}: ${r.imported} imported, ${r.skippedExisting} already present, ${r.skippedInvalid} invalid (of ${r.totalRows} DBF rows)`,
    );
  }
}
