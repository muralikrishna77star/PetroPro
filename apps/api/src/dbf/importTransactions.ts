#!/usr/bin/env node
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
 * Imports a fixed 3-month window of REAL legacy transactional data (bills, stock day-book,
 * purchases, mileage) for demo/showcase purposes — this is deliberately NOT a general historical
 * importer. docs/MIGRATION_NOTES.md explains why full transactional migration (decades of monthly
 * tables, each with its own consolidation logic) is out of scope; this covers exactly the most
 * recent 3 consecutive months that actually exist in legacy/Workarea/: 2019-04-01 through
 * 2019-06-15/16 (APRBIL19/MAYBIL19/JUNBIL19 + matching *STK19 + PURCH19 + MAGE19). Confirmed by
 * reading real BILL_DATE/SDATE/PUR_DATE values from the DBFs, not inferred from filenames alone
 * (the filename year suffix isn't reliably chronological — e.g. MARBIL02.DBF also exists).
 * Dates are kept exactly as they are in the source, not shifted to look "current" — see
 * AI_Handoff.md Session 11.
 *
 * Cancelled bills (BILLCNCS.DBF) are NOT imported here: that table lacks RATE/RATEBTX/TAX_PER/
 * TAX_AMT fields the modern bill_lines schema needs, so reconstructing them would mean inferring
 * tax figures never actually recorded for a cancelled sale — deliberately out of scope for this
 * pass rather than fabricating tax data. Receipts (RECPT19.DBF) are also skipped: the real dataset
 * has zero receipts in this window, so there's nothing to import (not a bug).
 */

const workareaDir = process.argv[2] ?? path.resolve(process.cwd(), "..", "..", "legacy", "Workarea");

const BILL_FILES = ["APRBIL19.DBF", "MAYBIL19.DBF", "JUNBIL19.DBF"];
const STOCK_FILES = ["APRSTK19.DBF", "MAYSTK19.DBF", "JUNSTK19.DBF"];
const PURCHASE_FILE = "PURCH19.DBF";
const MILEAGE_FILE = "MAGE19.DBF";
const WINDOW_FROM = "2019-04-01";
const WINDOW_TO = "2019-06-16";

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

interface MileageCandidate {
  legacyBillNo: number;
  vehicleNo: string;
  itemCode: string;
  qty: number;
  newBillNo: number;
}

function importBillFile(file: string, bills: ImportSummary, lines: ImportSummary, mileageCandidates: MileageCandidate[]): void {
  const rows = [...readDbfRows(path.join(workareaDir, file))];
  lines.totalRows += rows.length;

  // BILL_NO alone is NOT a reliable per-bill key: it repeats within the same file for
  // completely unrelated transactions (confirmed against the real data — e.g. APRBIL19's
  // BILL_NO=1 covers one 00:28 retail fuel sale to a specific vehicle AND an unrelated 22:19
  // multi-item entry with no vehicle/customer). BTIME is stamped identically across every line
  // of one real transaction and differs between them, so (BILL_NO, BTIME) is the actual key.
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

    const paymentType = customerCode ? "credit" : "cash";

    let subTotal = 0;
    let taxTotal = 0;
    const lineInputs: { item_code: string; qty: number; rate: number; rate_pretax: number; amount: number; tax_percent: number; tax_amount: number; is_retail: number; service_charge: number }[] = [];

    for (const row of group) {
      const itemCode = str(row, "ICODE");
      if (!itemsRepo.get(itemCode)) {
        lines.skippedInvalid++; // defensive FK check, matches import.ts's pattern
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
        mileageCandidates.push({ legacyBillNo, vehicleNo: vehicleNoRaw, itemCode: line.item_code, qty: line.qty, newBillNo });
      }
    }
  }
}

function importBills(): { bills: ImportSummary; lines: ImportSummary; mileageCandidates: MileageCandidate[] } {
  const bills: ImportSummary = { table: "bills (Apr-Jun 2019)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const lines: ImportSummary = { table: "bill_lines (Apr-Jun 2019)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const mileageCandidates: MileageCandidate[] = [];

  db.exec("BEGIN");
  try {
    for (const file of BILL_FILES) {
      importBillFile(file, bills, lines, mileageCandidates);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { bills, lines, mileageCandidates };
}

function importStock(): ImportSummary {
  const summary: ImportSummary = { table: "stock_daybook (Apr-Jun 2019)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const insert = db.prepare(
    `INSERT OR IGNORE INTO stock_daybook (item_code, sdate, opening, receipts, damaged, sales, closing, balance, closed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );

  db.exec("BEGIN");
  try {
    for (const file of STOCK_FILES) {
      for (const row of readDbfRows(path.join(workareaDir, file))) {
        summary.totalRows++;
        const itemCode = str(row, "ICODE");
        const sdate = str(row, "SDATE");
        if (!itemCode || !sdate || !itemsRepo.get(itemCode)) {
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
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return summary;
}

function importPurchases(): ImportSummary {
  const summary: ImportSummary = { table: "purchases (Apr-Jun 2019)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  for (const row of readDbfRows(path.join(workareaDir, PURCHASE_FILE))) {
    summary.totalRows++;
    const itemCode = str(row, "ICODE");
    const purDate = str(row, "PUR_DATE");
    if (!itemCode || !purDate || !itemsRepo.get(itemCode) || purDate < WINDOW_FROM || purDate > WINDOW_TO) {
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
  return summary;
}

function importMileage(candidates: MileageCandidate[]): ImportSummary {
  const summary: ImportSummary = { table: "mileage_log (Apr-Jun 2019)", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const insert = db.prepare(
    `INSERT INTO mileage_log (bill_no, vehicle_no, item_code, odometer_prev, odometer_curr, qty, mileage)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const row of readDbfRows(path.join(workareaDir, MILEAGE_FILE))) {
    summary.totalRows++;
    const legacyBillNo = num(row, "BILL_NO");
    const vehicleNo = str(row, "VEH_NO");
    const itemCode = str(row, "ICODE");
    const match = candidates.find(
      (c) => c.legacyBillNo === legacyBillNo && c.vehicleNo === vehicleNo && c.itemCode === itemCode,
    );
    if (!match) {
      summary.skippedInvalid++;
      continue;
    }
    insert.run(match.newBillNo, match.vehicleNo, match.itemCode, num(row, "OR") || null, num(row, "CR"), match.qty, num(row, "MILEAGE") || null);
    summary.imported++;
  }
  return summary;
}

/** Coarse, run-once guard: this script imports one fixed window, not an ongoing feed, so
 *  "any bill already dated in that window" is a reliable signal it already ran — cheaper and
 *  simpler than a per-row natural key, which bills/bill_lines/mileage_log don't have. */
function alreadyImported(): boolean {
  const row = db
    .prepare("SELECT 1 FROM bills WHERE date(bill_date) BETWEEN ? AND ? LIMIT 1")
    .get(WINDOW_FROM, WINDOW_TO) as unknown;
  return !!row;
}

export function runTransactionsImport(): ImportSummary[] | null {
  if (alreadyImported()) return null;

  const { bills, lines, mileageCandidates } = importBills();
  const stock = importStock();
  const purchases = importPurchases();
  const mileage = importMileage(mileageCandidates);
  return [bills, lines, stock, purchases, mileage];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Importing 2019-04-01..2019-06-15 demo transactions from ${workareaDir}\n`);
  const results = runTransactionsImport();
  if (results === null) {
    console.log("Already imported (bills exist in the 2019-04-01..2019-06-15 window) — nothing to do.");
  } else {
    for (const r of results) {
      console.log(
        `${r.table}: ${r.imported} imported, ${r.skippedExisting} already present, ${r.skippedInvalid} invalid (of ${r.totalRows} DBF rows)`,
      );
    }
  }
}
