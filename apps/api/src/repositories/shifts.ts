import { db } from "../db/client.js";

export interface Shift {
  id: number;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  status: "open" | "closed";
  notes: string | null;
}

export const shiftsRepo = {
  list(userId?: string): Shift[] {
    if (userId) {
      return db
        .prepare("SELECT * FROM shifts WHERE user_id = ? ORDER BY opened_at DESC")
        .all(userId) as unknown as Shift[];
    }
    return db.prepare("SELECT * FROM shifts ORDER BY opened_at DESC").all() as unknown as Shift[];
  },

  get(id: number): Shift | undefined {
    return db.prepare("SELECT * FROM shifts WHERE id = ?").get(id) as Shift | undefined;
  },

  getOpenForUser(userId: string): Shift | undefined {
    return db
      .prepare("SELECT * FROM shifts WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1")
      .get(userId) as Shift | undefined;
  },

  /** Cash sales (non-cancelled) posted by this user since `since`, up to now — used to compute
   *  a shift's expected closing cash. Upper bound is SQLite's own `datetime('now')` rather than
   *  a JS timestamp, so both sides of the comparison share the same "YYYY-MM-DD HH:MM:SS"
   *  format (mixing in a JS `toISOString()` value here would compare against a different
   *  string format and silently misbehave — see Project_Status.md's date-range-query gap). */
  cashSalesSince(userId: string, since: string): number {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(grand_total), 0) AS total FROM bills
         WHERE user_id = ? AND payment_type = 'cash' AND status != 'cancelled'
           AND bill_date BETWEEN ? AND datetime('now')`,
      )
      .get(userId, since) as unknown as { total: number };
    return row.total;
  },

  open(userId: string, openingCash: number): Shift {
    const result = db
      .prepare("INSERT INTO shifts (user_id, opening_cash) VALUES (?, ?)")
      .run(userId, openingCash);
    return shiftsRepo.get(Number(result.lastInsertRowid)) as Shift;
  },

  close(id: number, closingCash: number, expectedCash: number, notes?: string): Shift | undefined {
    db.prepare(
      `UPDATE shifts SET
        closed_at = datetime('now'), closing_cash = ?, expected_cash = ?,
        variance = ?, status = 'closed', notes = ?
       WHERE id = ?`,
    ).run(closingCash, expectedCash, closingCash - expectedCash, notes ?? null, id);
    return shiftsRepo.get(id);
  },
};
