import type { LegacyImportKind, LegacyImportReport, LegacyImportSkip } from "@petropro/shared-types";
import { db } from "../db/client.js";
import { parseDbf, type DbfRow } from "../dbf/reader.js";
import { businessDateRepo } from "../repositories/businessDate.js";
import { vehiclesRepo } from "../repositories/vehicles.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { createBackup } from "./backup.js";

/**
 * Uploaded Petbill (FoxPro 2.6) files: monthly sales `DECBIL25`, monthly stock `DECSTK25`, annual
 * purchases `PURCH25` and receipts `RECPT26`, whose suffix is a calendar year, and annual mileage `MAGE25`,
 * whose suffix is the year a financial year starts: BILLEN writes April 2025 to March 2026 there.
 *
 * Preview and import run the same analysis, so what's previewed is what gets written, and nothing
 * is written until the file is confirmed. Re-uploading is safe: rows already in PetroPro are matched
 * by content, which also covers data loaded earlier by dbf/importFY2025.ts, which kept no legacy key.
 *
 * These are history, so they post nothing onward. Customer dues aren't touched by bills or receipts,
 * and stock comes only from the STK files, whose RECEIPTS and SALES already include these purchases and bills.
 */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const FILE_NAME = new RegExp(`^(?:(${MONTHS.join("|")})(BIL|STK)|(PURCH|RECPT|MAGE))(\\d{2})(?:\\.DBF)?$`, "i");

const REQUIRED_FIELDS: Record<LegacyImportKind, string[]> = {
  sales: ["BILL_NO", "BILL_DATE", "ICODE", "QTY", "RATE", "AMT"],
  stock: ["ICODE", "SDATE", "OSTOCK", "CSTOCK"],
  purchases: ["ICODE", "QTY", "PUR_VALUE", "PUR_DATE"],
  receipts: ["REC_DATE", "CUST_CODE", "AMOUNT"],
  mileage: ["BILL_NO", "STATUS", "VEH_NO", "ICODE", "OR", "CR", "MILEAGE"],
};
const TAX_FIELDS = ["RATEBTX", "TAX_PER", "TAX_AMT"];
const MAX_EXAMPLES = 20;

export interface LegacyFilePeriod {
  kind: LegacyImportKind;
  label: string;
  from: string;
  to: string;
}

export class LegacyImportBlocked extends Error {}

/** Two digits can't say which century. Petbill's oldest files are from the late 1990s. */
function fullYear(suffix: string): number {
  const yy = Number(suffix);
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

/** Null for anything else, including leftovers such as ANOVBIL25.DBF, a stale partial copy of
 *  NOVBIL25.DBF that would otherwise pass as a month's data. */
export function parseLegacyFilename(filename: string): LegacyFilePeriod | null {
  const match = FILE_NAME.exec(filename.trim());
  if (!match) return null;
  const year = fullYear(match[4]);
  if (match[3]?.toUpperCase() === "MAGE") {
    return { kind: "mileage", label: `FY ${year}-${String(year + 1).slice(2)}`, from: `${year}-04-01`, to: `${year + 1}-03-31` };
  }
  if (match[3]) {
    const kind = match[3].toUpperCase() === "PURCH" ? "purchases" : "receipts";
    return { kind, label: String(year), from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const month = MONTHS.indexOf(match[1].toUpperCase());
  const mm = String(month + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    kind: match[2].toUpperCase() === "BIL" ? "sales" : "stock",
    label: `${match[1].toUpperCase()} ${year}`,
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function str(row: DbfRow, key: string): string {
  const v = row[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

function num(row: DbfRow, key: string): number {
  const v = row[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** FoxPro writes asterisks when a value overflows its column, so the real figure is gone. A blank
 *  numeric column is an ordinary zero. */
function hasOverflow(row: DbfRow, keys: string[]): boolean {
  return keys.some((key) => typeof row[key] === "number" && !Number.isFinite(row[key] as number));
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function codes(sql: string): Set<string> {
  return new Set((db.prepare(sql).all() as unknown as { code: string }[]).map((r) => r.code));
}

/** Counts a reason once per occurrence, keeping a few distinct examples to act on. */
class Skips {
  private byReason = new Map<string, LegacyImportSkip>();

  add(reason: string, example?: string): void {
    let skip = this.byReason.get(reason);
    if (!skip) {
      skip = { reason, count: 0, examples: [] };
      this.byReason.set(reason, skip);
    }
    skip.count++;
    if (example && skip.examples.length < MAX_EXAMPLES && !skip.examples.includes(example)) {
      skip.examples.push(example);
    }
  }

  list(): LegacyImportSkip[] {
    return [...this.byReason.values()];
  }
}

/** Takes one match per call, so two genuinely identical entries both count. */
function takeMatch(counts: Map<string, number>, key: string): boolean {
  const left = counts.get(key) ?? 0;
  if (left === 0) return false;
  counts.set(key, left - 1);
  return true;
}

function countKeys(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

interface Analysis {
  report: LegacyImportReport;
  apply: () => void;
}

function blankReport(filename: string, period: LegacyFilePeriod | null): LegacyImportReport {
  return {
    filename,
    kind: period?.kind ?? null,
    period: period?.label ?? null,
    blocked: null,
    rows: 0,
    to_import: 0,
    to_import_lines: 0,
    to_import_amount: 0,
    already_present: 0,
    skipped: [],
    notes: [],
    imported: false,
    backup: null,
  };
}

/** A file whose rows all sit outside its name's period is misnamed, not merely untidy. */
function blockIfMisnamed(report: LegacyImportReport, dates: string[], period: LegacyFilePeriod): boolean {
  if (dates.length === 0 || dates.some((d) => d >= period.from && d <= period.to)) return false;
  const sorted = [...dates].sort();
  report.blocked = `The name says ${period.label}, but the dates inside run from ${sorted[0]} to ${sorted[sorted.length - 1]}. Check this is the right file.`;
  return true;
}

function billKey(date: string, vehicle: string | null, customer: string | null, lines: { item: string; qty: number; amount: number }[]): string {
  const parts = lines.map((l) => `${l.item}:${l.qty.toFixed(3)}:${l.amount.toFixed(2)}`).sort();
  return `${date}|${vehicle ?? ""}|${customer ?? ""}|${parts.join(",")}`;
}

function existingBillKeys(period: LegacyFilePeriod): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT b.bill_no, b.bill_date, b.vehicle_no, b.customer_code, l.item_code, l.qty, l.amount
       FROM bills b JOIN bill_lines l ON l.bill_no = b.bill_no
       WHERE date(b.bill_date) BETWEEN ? AND ?`,
    )
    .all(period.from, period.to) as unknown as {
    bill_no: number;
    bill_date: string;
    vehicle_no: string | null;
    customer_code: string | null;
    item_code: string;
    qty: number;
    amount: number;
  }[];
  const bills = new Map<number, typeof rows>();
  for (const row of rows) bills.set(row.bill_no, [...(bills.get(row.bill_no) ?? []), row]);
  return countKeys(
    [...bills.values()].map((lines) =>
      billKey(
        lines[0].bill_date,
        lines[0].vehicle_no,
        lines[0].customer_code,
        lines.map((l) => ({ item: l.item_code, qty: l.qty, amount: l.amount })),
      ),
    ),
  );
}

function analyzeSales(report: LegacyImportReport, rows: DbfRow[], fields: Set<string>, period: LegacyFilePeriod): Analysis {
  const noop = { report, apply: () => undefined };
  if (blockIfMisnamed(report, rows.map((r) => str(r, "BILL_DATE")).filter(Boolean), period)) return noop;

  const skips = new Skips();
  const items = codes("SELECT code FROM items");
  const customers = codes("SELECT code FROM customers");
  const users = codes("SELECT user_id AS code FROM users");
  const existing = existingBillKeys(period);

  // BILL_NO repeats within a file because each STATUS has its own counter. STATUS and BILL_NO
  // identify a sale, as PRINTBIL finds them, and BTIME is identical on every line of one.
  const groups = new Map<string, DbfRow[]>();
  for (const row of rows) {
    const date = str(row, "BILL_DATE");
    if (date < period.from || date > period.to) {
      skips.add(`Rows dated outside ${period.label}`, date || "(no date)");
      continue;
    }
    const billNo = num(row, "BILL_NO");
    if (!billNo) {
      skips.add("Rows with no bill number");
      continue;
    }
    const key = [date, str(row, "STATUS"), billNo, str(row, "BTIME")].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const bills: {
    date: string;
    status: string;
    vehicle: string | null;
    customer: string | null;
    user: string | null;
    lines: DbfRow[];
    amount: number;
    tax: number;
  }[] = [];
  const newVehicles = new Set<string>();
  let unknownUsers = 0;

  for (const lines of groups.values()) {
    const first = lines[0];
    const label = `Bill ${num(first, "BILL_NO")} on ${str(first, "BILL_DATE")}`;

    // A partial bill would understate the sale, and a credit bill without its customer would pass
    // as cash, so these wait for the catalog or customer to be added and the file uploaded again.
    const unknownItem = lines.map((l) => str(l, "ICODE")).find((code) => !items.has(code));
    if (unknownItem !== undefined) {
      skips.add("Bills with an item code not in the Catalog", unknownItem || "(blank)");
      continue;
    }
    const customer = str(first, "CUST_CODE") || null;
    if (customer && !customers.has(customer)) {
      skips.add("Bills with a customer code not in Customers", customer);
      continue;
    }
    const missingFigure = lines.some((l) => typeof l.QTY !== "number" || typeof l.AMT !== "number");
    if (missingFigure || lines.some((l) => hasOverflow(l, ["QTY", "RATE", "AMT", "SER_CHG", ...TAX_FIELDS]))) {
      skips.add("Bills with an unreadable quantity or amount", label);
      continue;
    }

    const btime = str(first, "BTIME");
    const date = `${str(first, "BILL_DATE")} ${/^\d{2}:\d{2}:\d{2}$/.test(btime) ? btime : "00:00:00"}`;
    const vehicle = str(first, "VEH_NO") || null;
    const key = billKey(
      date,
      vehicle,
      customer,
      lines.map((l) => ({ item: str(l, "ICODE"), qty: num(l, "QTY"), amount: num(l, "AMT") })),
    );
    if (takeMatch(existing, key)) {
      report.already_present++;
      continue;
    }

    const user = str(first, "USER_ID") || null;
    if (user && !users.has(user)) unknownUsers++;
    if (vehicle && !vehiclesRepo.get(vehicle)) newVehicles.add(vehicle);
    bills.push({
      date,
      status: str(first, "STATUS"),
      vehicle,
      customer,
      user: user && users.has(user) ? user : null,
      lines,
      amount: lines.reduce((sum, l) => sum + num(l, "AMT"), 0),
      tax: lines.reduce((sum, l) => sum + num(l, "TAX_AMT"), 0),
    });
    report.to_import_lines += lines.length;
  }

  report.to_import = bills.length;
  report.to_import_amount = money(bills.reduce((sum, b) => sum + b.amount, 0));
  report.skipped = skips.list();
  const hasTax = TAX_FIELDS.every((f) => fields.has(f));
  if (!hasTax) report.notes.push("This file has no tax columns, so these bills are recorded with no tax.");
  if (newVehicles.size > 0) report.notes.push(`${newVehicles.size} vehicle number(s) will be added to PetroPro.`);
  if (unknownUsers > 0) report.notes.push(`${unknownUsers} bill(s) name a cashier not in PetroPro, so they'll show no cashier.`);

  return {
    report,
    apply() {
      const insertBill = db.prepare(
        `INSERT INTO bills (bill_date, vehicle_no, customer_code, user_id, sub_total, tax_total, grand_total, payment_type, legacy_bill_no, legacy_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertLine = db.prepare(
        `INSERT INTO bill_lines (bill_no, item_code, qty, rate, rate_pretax, amount, tax_percent, tax_amount, is_retail, service_charge)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const bill of bills) {
        if (bill.vehicle) vehiclesRepo.findOrCreate(bill.vehicle);
        // STATUS is the bill type ('C' cash, 'R' credit, 'K' kerosene), each with its own BILL_NO
        // counter. In the real files every 'R' row has a customer and no 'C' row does.
        const result = insertBill.run(
          bill.date,
          bill.vehicle,
          bill.customer,
          bill.user,
          money(bill.amount - bill.tax),
          money(bill.tax),
          money(bill.amount),
          bill.customer ? "credit" : "cash",
          num(bill.lines[0], "BILL_NO"),
          bill.status || null,
        );
        for (const line of bill.lines) {
          insertLine.run(
            Number(result.lastInsertRowid),
            str(line, "ICODE"),
            num(line, "QTY"),
            num(line, "RATE"),
            hasTax ? num(line, "RATEBTX") : num(line, "RATE"),
            num(line, "AMT"),
            num(line, "TAX_PER"),
            num(line, "TAX_AMT"),
            num(line, "RETAIL") ? 1 : 0,
            num(line, "SER_CHG"),
          );
        }
      }
    },
  };
}

function analyzeStock(report: LegacyImportReport, rows: DbfRow[], period: LegacyFilePeriod): Analysis {
  const noop = { report, apply: () => undefined };
  if (blockIfMisnamed(report, rows.map((r) => str(r, "SDATE")).filter(Boolean), period)) return noop;

  const skips = new Skips();
  const items = codes("SELECT code FROM items");
  const stored = db
    .prepare("SELECT item_code, sdate, closed FROM stock_daybook WHERE sdate BETWEEN ? AND ?")
    .all(period.from, period.to) as unknown as { item_code: string; sdate: string; closed: number }[];
  const seen = new Set(stored.map((r) => `${r.item_code}|${r.sdate}`));
  const openDays = new Set(stored.filter((r) => !r.closed).map((r) => r.sdate));
  const businessDate = businessDateRepo.get();
  const toInsert: DbfRow[] = [];

  for (const row of rows) {
    const date = str(row, "SDATE");
    const item = str(row, "ICODE");
    if (date < period.from || date > period.to) {
      skips.add(`Rows dated outside ${period.label}`, date || "(no date)");
    } else if (date >= businessDate) {
      // An imported row is a closed one, and one closed row closes the whole day. On the current
      // day that stops live billing, and earlier ones would move the business date.
      skips.add(`Rows on or after PetroPro's current business date (${businessDate})`, date);
    } else if (openDays.has(date)) {
      skips.add("Rows for a day PetroPro is still using and hasn't closed", date);
    } else if (!items.has(item)) {
      skips.add("Rows with an item code not in the Catalog", item || "(blank)");
    } else if (hasOverflow(row, ["OSTOCK", "RECEIPTS", "DAMAGED", "SALES", "CSTOCK", "BALANCE"])) {
      skips.add("Rows with an unreadable quantity", `${item} on ${date}`);
    } else if (seen.has(`${item}|${date}`)) {
      report.already_present++;
    } else {
      seen.add(`${item}|${date}`);
      toInsert.push(row);
    }
  }

  report.to_import = toInsert.length;
  report.skipped = skips.list();
  return {
    report,
    apply() {
      const insert = db.prepare(
        `INSERT INTO stock_daybook (item_code, sdate, opening, receipts, damaged, sales, closing, balance, closed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      );
      for (const row of toInsert) {
        insert.run(
          str(row, "ICODE"),
          str(row, "SDATE"),
          num(row, "OSTOCK"),
          num(row, "RECEIPTS"),
          num(row, "DAMAGED"),
          num(row, "SALES"),
          num(row, "CSTOCK"),
          num(row, "BALANCE"),
        );
      }
    },
  };
}

function purchaseKey(date: string, item: string, qty: number, value: number, invoice: string | null): string {
  return `${date}|${item}|${qty.toFixed(3)}|${value.toFixed(2)}|${invoice ?? ""}`;
}

function invoiceOf(row: DbfRow): string | null {
  const invoice = num(row, "INVNO");
  return invoice > 0 ? String(invoice) : null;
}

function analyzePurchases(report: LegacyImportReport, rows: DbfRow[], period: LegacyFilePeriod): Analysis {
  const noop = { report, apply: () => undefined };
  if (blockIfMisnamed(report, rows.map((r) => str(r, "PUR_DATE")).filter(Boolean), period)) return noop;

  const skips = new Skips();
  const items = codes("SELECT code FROM items");
  const last = (db.prepare("SELECT max(date(pur_date)) AS d FROM purchases").get() as { d: string | null }).d;
  // The last day itself is compared row by row: it may only have been part-way through when the
  // file was last copied, so a plain "after the last date" would lose its later purchases.
  const onLastDay = last
    ? countKeys(
        (db
          .prepare("SELECT item_code, qty, value, invoice_no FROM purchases WHERE date(pur_date) = ?")
          .all(last) as unknown as { item_code: string; qty: number; value: number; invoice_no: string | null }[]).map((r) =>
          purchaseKey(last, r.item_code, r.qty, r.value, r.invoice_no),
        ),
      )
    : new Map<string, number>();
  const toInsert: DbfRow[] = [];

  for (const row of rows) {
    const date = str(row, "PUR_DATE");
    const item = str(row, "ICODE");
    if (date < period.from || date > period.to) {
      skips.add(`Rows dated outside ${period.label}`, date || "(no date)");
    } else if (last && date < last) {
      skips.add(`Purchases older than the last one in PetroPro (${last})`);
    } else if (!items.has(item)) {
      skips.add("Rows with an item code not in the Catalog", item || "(blank)");
    } else if (typeof row.QTY !== "number" || typeof row.PUR_VALUE !== "number" || hasOverflow(row, ["QTY", "PUR_VALUE", "VAT_AMT"])) {
      skips.add("Rows with an unreadable quantity or value", `${item} on ${date}`);
    } else if (date === last && takeMatch(onLastDay, purchaseKey(date, item, num(row, "QTY"), num(row, "PUR_VALUE"), invoiceOf(row)))) {
      report.already_present++;
    } else {
      toInsert.push(row);
    }
  }

  report.to_import = toInsert.length;
  report.to_import_amount = money(toInsert.reduce((sum, r) => sum + num(r, "PUR_VALUE"), 0));
  report.skipped = skips.list();
  report.notes.push(
    last
      ? `The last purchase in PetroPro is dated ${last}, so this picks up from that date onwards.`
      : "PetroPro has no purchases yet, so this picks up from the start of the file.",
  );
  return {
    report,
    apply() {
      const insert = db.prepare(
        "INSERT INTO purchases (item_code, qty, value, pur_date, invoice_no, vat_amount) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const row of toInsert) {
        insert.run(str(row, "ICODE"), num(row, "QTY"), num(row, "PUR_VALUE"), str(row, "PUR_DATE"), invoiceOf(row), num(row, "VAT_AMT"));
      }
    },
  };
}

function receiptKey(date: string, customer: string, amount: number, mode: string, cheque: string | null): string {
  return `${date}|${customer}|${amount.toFixed(2)}|${mode}|${cheque ?? ""}`;
}

function chequeOf(row: DbfRow): string | null {
  const cheque = str(row, "CHQNO");
  return cheque && cheque !== "0" ? cheque : null;
}

function analyzeReceipts(report: LegacyImportReport, rows: DbfRow[], period: LegacyFilePeriod): Analysis {
  const noop = { report, apply: () => undefined };
  if (blockIfMisnamed(report, rows.map((r) => str(r, "REC_DATE")).filter(Boolean), period)) return noop;

  const skips = new Skips();
  const customers = codes("SELECT code FROM customers");
  const users = codes("SELECT user_id AS code FROM users");
  // The whole year is compared, not just from the last receipt: a receipt entered late in Petbill
  // would otherwise be lost, and that's money received.
  const existing = countKeys(
    (db
      .prepare(
        `SELECT date(rec_date) AS rec_date, customer_code, amount, mode, cheque_no FROM receipts
         WHERE date(rec_date) BETWEEN ? AND ?`,
      )
      .all(period.from, period.to) as unknown as {
      rec_date: string;
      customer_code: string;
      amount: number;
      mode: string;
      cheque_no: string | null;
    }[]).map((r) => receiptKey(r.rec_date, r.customer_code, r.amount, r.mode, r.cheque_no)),
  );
  const toInsert: { row: DbfRow; mode: string; cashier: string | null }[] = [];
  const readAsCash = new Set<string>();
  let unknownCashiers = 0;

  for (const row of rows) {
    const date = str(row, "REC_DATE");
    const customer = str(row, "CUST_CODE");
    const code = str(row, "CSHORCHQ").toUpperCase();
    const mode = code === "CQ" ? "cheque" : "cash";
    if (date < period.from || date > period.to) {
      skips.add(`Rows dated outside ${period.label}`, date || "(no date)");
    } else if (!customers.has(customer)) {
      // A receipt belongs to a customer, so unlike a bill it has no cash-sale fallback.
      skips.add("Receipts with a customer code not in Customers", customer || "(blank)");
    } else if (typeof row.AMOUNT !== "number" || hasOverflow(row, ["AMOUNT", "SC_AMT"])) {
      skips.add("Receipts with an unreadable amount", `${customer} on ${date}`);
    } else if (takeMatch(existing, receiptKey(date, customer, num(row, "AMOUNT"), mode, chequeOf(row)))) {
      report.already_present++;
    } else {
      if (mode === "cash" && code) readAsCash.add(code);
      const cashier = str(row, "CSR_INIT") || null;
      if (cashier && !users.has(cashier)) unknownCashiers++;
      toInsert.push({ row, mode, cashier: cashier && users.has(cashier) ? cashier : null });
    }
  }

  report.to_import = toInsert.length;
  report.to_import_amount = money(toInsert.reduce((sum, r) => sum + num(r.row, "AMOUNT"), 0));
  report.skipped = skips.list();
  if (readAsCash.size > 0) report.notes.push(`Payment codes read as cash: ${[...readAsCash].join(", ")}. Only CQ is read as a cheque.`);
  if (unknownCashiers > 0) report.notes.push(`${unknownCashiers} receipt(s) name a cashier not in PetroPro, so they'll show no cashier.`);
  return {
    report,
    apply() {
      const insert = db.prepare(
        `INSERT INTO receipts (rec_date, customer_code, amount, mode, cheque_no, bank_name, service_charge, cashier_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const { row, mode, cashier } of toInsert) {
        insert.run(
          str(row, "REC_DATE"),
          str(row, "CUST_CODE"),
          num(row, "AMOUNT"),
          mode,
          chequeOf(row),
          str(row, "BANKNAME") || null,
          num(row, "SC_AMT"),
          cashier,
        );
      }
    },
  };
}

/**
 * MAGE has no date, so a row finds its bill by Petbill's number and type within the financial year,
 * which is how PRINTBIL finds it. It only reaches bills imported through this screen, as earlier
 * imports kept no legacy number. Anything that doesn't lead to exactly one bill is reported, not guessed.
 */
function analyzeMileage(report: LegacyImportReport, rows: DbfRow[], period: LegacyFilePeriod): Analysis {
  const skips = new Skips();
  const bills = db
    .prepare(
      `SELECT bill_no, legacy_bill_no, legacy_status, payment_type, vehicle_no FROM bills
       WHERE legacy_bill_no IS NOT NULL AND date(bill_date) BETWEEN ? AND ?`,
    )
    .all(period.from, period.to) as unknown as {
    bill_no: number;
    legacy_bill_no: number;
    legacy_status: string | null;
    payment_type: string;
    vehicle_no: string | null;
  }[];
  const byNumber = new Map<number, typeof bills>();
  for (const bill of bills) byNumber.set(bill.legacy_bill_no, [...(byNumber.get(bill.legacy_bill_no) ?? []), bill]);

  const lineRows = db
    .prepare(
      `SELECT l.bill_no, l.item_code, l.qty, COALESCE(i.track_mileage, 0) AS track_mileage
       FROM bill_lines l JOIN bills b ON b.bill_no = l.bill_no LEFT JOIN items i ON i.code = l.item_code
       WHERE b.legacy_bill_no IS NOT NULL AND date(b.bill_date) BETWEEN ? AND ? ORDER BY l.id`,
    )
    .all(period.from, period.to) as unknown as { bill_no: number; item_code: string; qty: number; track_mileage: number }[];
  const linesOf = new Map<number, typeof lineRows>();
  for (const line of lineRows) linesOf.set(line.bill_no, [...(linesOf.get(line.bill_no) ?? []), line]);

  const stored = db
    .prepare(
      `SELECT m.bill_no, m.odometer_curr FROM mileage_log m JOIN bills b ON b.bill_no = m.bill_no
       WHERE b.legacy_bill_no IS NOT NULL AND date(b.bill_date) BETWEEN ? AND ?`,
    )
    .all(period.from, period.to) as unknown as { bill_no: number; odometer_curr: number }[];
  const seen = new Set(stored.map((m) => `${m.bill_no}|${m.odometer_curr}`));

  const toInsert: { bill_no: number; vehicle: string; item: string; prev: number | null; curr: number; qty: number; mileage: number | null }[] = [];
  const legacyPayment: Record<string, string> = { C: "cash", R: "credit" };
  let repeats = 0;
  let noReading = 0;
  const repeatKeys = new Set<string>();

  for (const row of rows) {
    const legacyNo = num(row, "BILL_NO");
    const status = str(row, "STATUS");
    const vehicle = str(row, "VEH_NO");
    const label = `Bill ${legacyNo}`;
    // BILLEN saves each reading twice, so an exact repeat is the same reading.
    const key = [status, legacyNo, vehicle, str(row, "ICODE"), row.OR, row.CR, row.MILEAGE].join("|");
    if (repeatKeys.has(key)) {
      repeats++;
      continue;
    }
    repeatKeys.add(key);
    if (hasOverflow(row, ["OR", "CR", "MILEAGE"])) {
      skips.add("Rows with an unreadable reading", label);
      continue;
    }
    // Zeros mean nothing was entered. Storing one would also become this vehicle's latest reading.
    if (num(row, "CR") <= 0) {
      noReading++;
      continue;
    }
    const sameNumber = (byNumber.get(legacyNo) ?? []).filter(
      (b) => b.legacy_status === status || (b.legacy_status === null && b.payment_type === legacyPayment[status]),
    );
    if (sameNumber.length === 0) {
      skips.add("Readings for bills not in PetroPro. Import that month's sales first", label);
      continue;
    }
    const candidates = sameNumber.filter((b) => (b.vehicle_no ?? "").toUpperCase() === vehicle.toUpperCase());
    if (candidates.length === 0) {
      skips.add("Readings whose vehicle differs from the bill's", label);
      continue;
    }
    if (candidates.length > 1) {
      skips.add("Readings that match more than one bill", label);
      continue;
    }
    const bill = candidates[0];
    if (seen.has(`${bill.bill_no}|${num(row, "CR")}`)) {
      report.already_present++;
      continue;
    }
    // Petbill worked the mileage out from the bill's fuel line, though a row can name another item
    // from the same bill, such as a cloth entered last.
    const lines = linesOf.get(bill.bill_no) ?? [];
    const fuel = lines.filter((l) => l.track_mileage);
    const line = fuel.find((l) => l.item_code === str(row, "ICODE")) ?? fuel[0] ?? lines.find((l) => l.item_code === str(row, "ICODE"));
    if (!line) {
      skips.add("Readings for an item that isn't on the bill", label);
      continue;
    }
    seen.add(`${bill.bill_no}|${num(row, "CR")}`);
    toInsert.push({
      bill_no: bill.bill_no,
      vehicle: bill.vehicle_no ?? vehicle,
      item: line.item_code,
      prev: num(row, "OR") > 0 ? num(row, "OR") : null,
      curr: num(row, "CR"),
      qty: line.qty,
      mileage: num(row, "MILEAGE") > 0 ? num(row, "MILEAGE") : null,
    });
  }

  report.to_import = toInsert.length;
  report.skipped = skips.list();
  report.notes.push(`This file covers ${period.label}, April to March.`);
  if (repeats > 0) report.notes.push(`${repeats} repeated row(s) counted once. Petbill saves each reading twice.`);
  if (noReading > 0) report.notes.push(`${noReading} row(s) with no reading (0) left out.`);
  return {
    report,
    apply() {
      const insert = db.prepare(
        "INSERT INTO mileage_log (bill_no, vehicle_no, item_code, odometer_prev, odometer_curr, qty, mileage) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const r of toInsert) insert.run(r.bill_no, r.vehicle, r.item, r.prev, r.curr, r.qty, r.mileage);
    },
  };
}

function analyze(filename: string, content: Buffer): Analysis {
  const period = parseLegacyFilename(filename);
  const report = blankReport(filename, period);
  const noop = { report, apply: () => undefined };
  if (!period) {
    report.blocked = "This name isn't one PetroPro recognises. Use a name like DECBIL25.DBF, DECSTK25.DBF, PURCH25.DBF, RECPT26.DBF or MAGE25.DBF.";
    return noop;
  }

  let parsed: ReturnType<typeof parseDbf>;
  try {
    parsed = parseDbf(content);
  } catch (err) {
    report.blocked = `This can't be read as a FoxPro table: ${(err as Error).message}`;
    return noop;
  }
  const fields = new Set(parsed.table.fields.map((f) => f.name));
  const missing = REQUIRED_FIELDS[period.kind].filter((f) => !fields.has(f));
  if (missing.length > 0) {
    report.blocked = `This doesn't look like a ${period.kind} file. Missing column(s): ${missing.join(", ")}.`;
    return noop;
  }

  const rows = [...parsed.rows()];
  report.rows = rows.length;
  if (period.kind === "sales") return analyzeSales(report, rows, fields, period);
  if (period.kind === "stock") return analyzeStock(report, rows, period);
  if (period.kind === "receipts") return analyzeReceipts(report, rows, period);
  if (period.kind === "mileage") return analyzeMileage(report, rows, period);
  return analyzePurchases(report, rows, period);
}

export function previewLegacyFile(filename: string, content: Buffer): LegacyImportReport {
  return analyze(filename, content).report;
}

/** All or nothing per file, and the backup comes first so a whole batch can be undone. */
export function importLegacyFile(filename: string, content: Buffer, userId: string, withBackup: boolean): LegacyImportReport {
  const { report, apply } = analyze(filename, content);
  if (report.blocked) throw new LegacyImportBlocked(report.blocked);
  if (report.to_import === 0) return report;

  if (withBackup) report.backup = createBackup().filename;
  db.exec("BEGIN");
  try {
    apply();
    auditLogsRepo.record({
      user_id: userId,
      action: "legacy_import",
      entity_type: "legacy_file",
      entity_id: filename,
      details: {
        kind: report.kind,
        period: report.period,
        imported: report.to_import,
        lines: report.to_import_lines,
        amount: report.to_import_amount,
        already_present: report.already_present,
        skipped: report.skipped.map((s) => ({ reason: s.reason, count: s.count })),
        backup: report.backup,
      },
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  report.imported = true;
  return report;
}
