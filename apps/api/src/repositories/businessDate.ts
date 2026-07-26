import { db } from "../db/client.js";
import { stockRepo, todayDateOnly } from "./stock.js";

function nextDay(date: string): string {
  return (db.prepare("SELECT date(?, '+1 day') AS d").get(date) as { d: string }).d;
}

/**
 * The "running" business date bills and stock postings use, distinct from the wall-clock date.
 * It starts equal to today and only moves forward when a cashier closes the day (advance below)
 * — so it can lag behind the real calendar date but never run ahead of it.
 */
export const businessDateRepo = {
  /** The earliest date on/after the stored register that hasn't been closed yet, capped at the
   *  real calendar date. Self-heals across a real midnight rollover: if the stored date was
   *  closed yesterday, this walks it forward (without needing a separate close action) as soon
   *  as the real date has actually moved past it. */
  get(): string {
    const row = db.prepare("SELECT running_date FROM business_date WHERE id = 1").get() as
      | { running_date: string }
      | undefined;
    let current = row?.running_date ?? todayDateOnly();
    const today = todayDateOnly();
    while (current < today && stockRepo.isDateClosed(current)) {
      current = nextDay(current);
    }
    if (current !== row?.running_date) {
      db.prepare("UPDATE business_date SET running_date = ? WHERE id = 1").run(current);
    }
    return current;
  },

  /** Advances the running date by one day, capped at the real calendar date so it never gets
   *  ahead of "now" — call right after a cashier closes the current running date. */
  advance(): string {
    const current = businessDateRepo.get();
    const today = todayDateOnly();
    const next = current < today ? nextDay(current) : today;
    db.prepare("UPDATE business_date SET running_date = ? WHERE id = 1").run(next);
    return next;
  },
};
