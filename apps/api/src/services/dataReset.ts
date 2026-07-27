import { db } from "../db/client.js";
import { createBackup, type BackupFile } from "./backup.js";

export interface ResetSummary {
  backup: BackupFile;
  clearedTables: string[];
  finYearStart: string;
}

/** Transactional/history tables — cleared on a "go live" reset. Deliberately excludes setup
 *  data (groups, items, customers, vehicles, fleet_cards, pumps, tenants, settings, users):
 *  that's the client's configuration work, not demo history, and shouldn't be lost.
 *
 *  Order matters here — `PRAGMA foreign_keys = ON` (schema.ts) means a parent row can't be
 *  deleted while a child still references it, so every table referencing `bills`/`order_lines`/
 *  `orders` must be cleared before the table it references: bill_lines/pending_transactions/
 *  mileage_log before bills; bill_lines (already gone) before order_lines; order_lines before
 *  orders. */
const TRANSACTIONAL_TABLES = [
  "bill_lines",
  "pending_transactions",
  "mileage_log",
  "bills",
  "order_lines",
  "orders",
  "stock_daybook",
  "purchases",
  "receipts",
  "audit_logs",
  "shifts",
  "opening_balances",
];

const AUTOINCREMENT_TABLES = [
  "bills",
  "pending_transactions",
  "purchases",
  "receipts",
  "mileage_log",
  "audit_logs",
  "shifts",
  "order_lines",
  "orders",
];

/**
 * "Start using the app for real, from today" — clears every transactional/history table (real
 * legacy demo data, test bills, etc.) while keeping everything the client configured (catalog,
 * customers, pumps, tenant identity, users). Auto-backs-up first via the existing backup
 * mechanism, so this is recoverable even though it's otherwise irreversible. Resets bill/purchase/
 * receipt numbering back to 1 (via sqlite_sequence) so the client's first real bill is #1, not a
 * continuation of demo numbering. Also resets every customer's due_amount to 0 (accrued from
 * demo bills, not real debt) and bumps the financial year start to today.
 */
export function resetTransactionalData(): ResetSummary {
  const backup = createBackup();

  db.exec("BEGIN");
  try {
    for (const table of TRANSACTIONAL_TABLES) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.exec("UPDATE customers SET due_amount = 0");

    const placeholders = AUTOINCREMENT_TABLES.map(() => "?").join(",");
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`).run(...AUTOINCREMENT_TABLES);

    const finYearStart = new Date().toISOString().slice(0, 10);
    db.prepare("UPDATE fin_years SET fin_year_start = ? WHERE id = 1").run(finYearStart);
    db.prepare("UPDATE business_date SET running_date = ? WHERE id = 1").run(finYearStart);

    db.exec("COMMIT");
    return { backup, clearedTables: TRANSACTIONAL_TABLES, finYearStart };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
