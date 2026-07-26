import { db } from "../db/client.js";
import { itemsRepo } from "./items.js";

export interface StockDaybookRow {
  item_code: string;
  sdate: string;
  opening: number;
  receipts: number;
  damaged: number;
  sales: number;
  closing: number;
  balance: number;
  closed: number;
}

export function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function getRow(itemCode: string, date: string): StockDaybookRow | undefined {
  return db
    .prepare("SELECT * FROM stock_daybook WHERE item_code = ? AND sdate = ?")
    .get(itemCode, date) as unknown as StockDaybookRow | undefined;
}

function isDateClosed(date: string): boolean {
  return (
    db.prepare("SELECT 1 FROM stock_daybook WHERE sdate = ? AND closed = 1 LIMIT 1").get(date) !==
    undefined
  );
}

/** Throws if `date`'s stock book has already been closed (closeDay) — call before any
 *  sale/receipt/reversal posts to that date. A closed date closes all items at once, so a
 *  closed row for any item on that date means the whole day is closed, including items that
 *  had no row yet at close time. */
function assertDateOpen(date: string): void {
  if (isDateClosed(date)) {
    throw new Error(`Stock day ${date} is closed to further postings`);
  }
}

function getOrCreateRow(itemCode: string, date: string): StockDaybookRow {
  const existing = getRow(itemCode, date);
  if (existing) return existing;

  const previous = db
    .prepare(
      "SELECT * FROM stock_daybook WHERE item_code = ? AND sdate < ? ORDER BY sdate DESC LIMIT 1",
    )
    .get(itemCode, date) as unknown as StockDaybookRow | undefined;
  const opening = previous?.closing ?? 0;

  db.prepare(
    `INSERT INTO stock_daybook (item_code, sdate, opening, receipts, damaged, sales, closing, balance)
     VALUES (?, ?, ?, 0, 0, 0, ?, ?)`,
  ).run(itemCode, date, opening, opening, opening);

  return getRow(itemCode, date) as StockDaybookRow;
}

export const stockRepo = {
  getRow,

  listByDate(date: string): StockDaybookRow[] {
    return db
      .prepare("SELECT * FROM stock_daybook WHERE sdate = ? ORDER BY item_code")
      .all(date) as unknown as StockDaybookRow[];
  },

  listRange(from: string, to: string, itemCode?: string): StockDaybookRow[] {
    if (itemCode) {
      return db
        .prepare(
          "SELECT * FROM stock_daybook WHERE item_code = ? AND sdate BETWEEN ? AND ? ORDER BY sdate",
        )
        .all(itemCode, from, to) as unknown as StockDaybookRow[];
    }
    return db
      .prepare("SELECT * FROM stock_daybook WHERE sdate BETWEEN ? AND ? ORDER BY item_code, sdate")
      .all(from, to) as unknown as StockDaybookRow[];
  },

  isDateClosed,

  /** Decrements balance for a sale (bill line). Rolls forward from the prior day's closing
   *  balance if today's row doesn't exist yet. Throws if `date` is already closed. */
  applySale(itemCode: string, qty: number, date: string = todayDateOnly()): void {
    assertDateOpen(date);
    getOrCreateRow(itemCode, date);
    db.prepare(
      `UPDATE stock_daybook SET sales = sales + ?, balance = balance - ?, closing = closing - ?
       WHERE item_code = ? AND sdate = ?`,
    ).run(qty, qty, qty, itemCode, date);
  },

  /** Increments balance for a purchase receipt. Throws if `date` is already closed. */
  applyReceipt(itemCode: string, qty: number, date: string = todayDateOnly()): void {
    assertDateOpen(date);
    getOrCreateRow(itemCode, date);
    db.prepare(
      `UPDATE stock_daybook SET receipts = receipts + ?, balance = balance + ?, closing = closing + ?
       WHERE item_code = ? AND sdate = ?`,
    ).run(qty, qty, qty, itemCode, date);
  },

  /** Undoes a prior applySale (bill cancellation) on the day the original sale posted to.
   *  Throws if `date` is already closed — a cancellation can't retroactively edit a closed day. */
  reverseSale(itemCode: string, qty: number, date: string): void {
    assertDateOpen(date);
    getOrCreateRow(itemCode, date);
    db.prepare(
      `UPDATE stock_daybook SET sales = sales - ?, balance = balance + ?, closing = closing + ?
       WHERE item_code = ? AND sdate = ?`,
    ).run(qty, qty, qty, itemCode, date);
  },

  /** Marks a business day's stock book as finalized for reporting. Blocks further sales,
   *  receipts and reversals against that date (enforced in applySale/applyReceipt/reverseSale).
   *  Rolls forward a row for every item first — including ones that never transacted on this
   *  date — so isDateClosed(date) is true even when closing a date with no rows yet. */
  closeDay(date: string): number {
    for (const item of itemsRepo.list()) {
      getOrCreateRow(item.code, date);
    }
    const result = db.prepare("UPDATE stock_daybook SET closed = 1 WHERE sdate = ?").run(date);
    return Number(result.changes);
  },
};
