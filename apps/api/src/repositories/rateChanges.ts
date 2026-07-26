import { db } from "../db/client.js";

export interface RateChange {
  id: number;
  item_code: string;
  rate: number;
  scheduled_on: string;
  applied: number;
  applied_at: string | null;
}

export interface RateChangeInput {
  item_code: string;
  rate: number;
  scheduled_on: string;
}

export const rateChangesRepo = {
  list(onlyPending = false): RateChange[] {
    if (onlyPending) {
      return db
        .prepare("SELECT * FROM rate_changes WHERE applied = 0 ORDER BY scheduled_on")
        .all() as unknown as RateChange[];
    }
    return db.prepare("SELECT * FROM rate_changes ORDER BY scheduled_on DESC").all() as unknown as RateChange[];
  },

  dueOn(date: string): RateChange[] {
    return db
      .prepare("SELECT * FROM rate_changes WHERE applied = 0 AND scheduled_on <= ? ORDER BY scheduled_on")
      .all(date) as unknown as RateChange[];
  },

  create(input: RateChangeInput): RateChange {
    const result = db
      .prepare("INSERT INTO rate_changes (item_code, rate, scheduled_on) VALUES (?, ?, ?)")
      .run(input.item_code, input.rate, input.scheduled_on);
    return db
      .prepare("SELECT * FROM rate_changes WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as unknown as RateChange;
  },

  get(id: number): RateChange | undefined {
    return db.prepare("SELECT * FROM rate_changes WHERE id = ?").get(id) as unknown as RateChange | undefined;
  },

  markApplied(id: number): void {
    db.prepare("UPDATE rate_changes SET applied = 1, applied_at = datetime('now') WHERE id = ?").run(id);
  },

  /** Only a still-pending change can be retracted — once applied it's already changed the item's
   *  live rate, so deleting the row would erase the audit trail for something that actually happened. */
  remove(id: number): boolean {
    const result = db.prepare("DELETE FROM rate_changes WHERE id = ? AND applied = 0").run(id);
    return result.changes > 0;
  },
};
