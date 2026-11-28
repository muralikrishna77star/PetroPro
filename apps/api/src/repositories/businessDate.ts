import { db } from "../db/client.js";
import { stockRepo } from "./stock.js";
import { closeDaySettingsRepo } from "./closeDaySettings.js";
import { config } from "../config.js";

/** The station's calendar date ("YYYY-MM-DD") at `instant`. */
export function stationDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.stationTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Today's date for billing: the station's date, changing over at Close Day's change-over time
 *  instead of midnight — at 03:00 with a 05:30 change-over it's still yesterday. With the default
 *  change-over this equals the UTC date (todayDateOnly), as it always has. */
export function businessToday(now = new Date()): string {
  const [hours, minutes] = closeDaySettingsRepo.get().day_changeover_time.split(":").map(Number);
  return stationDate(new Date(now.getTime() - (hours * 60 + minutes) * 60_000));
}

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
    let current = row?.running_date ?? businessToday();
    const today = businessToday();
    while (current < today && stockRepo.isDateClosed(current)) {
      current = nextDay(current);
    }
    if (current !== row?.running_date) {
      db.prepare("UPDATE business_date SET running_date = ? WHERE id = 1").run(current);
    }
    return current;
  },

  /** Advances the running date by one day — call right after a cashier closes the current
   *  running date. Normally capped at the real calendar date so it never gets ahead of "now";
   *  with Close Day's "tomorrow straight away" setting it moves on to the next date regardless,
   *  which can put it one day ahead (closing a date that hasn't begun is refused in
   *  services/closeDay.ts, so it can't run further than that). */
  advance(): string {
    const current = businessDateRepo.get();
    const today = businessToday();
    const next =
      current < today || closeDaySettingsRepo.get().next_date === "tomorrow" ? nextDay(current) : today;
    db.prepare("UPDATE business_date SET running_date = ? WHERE id = 1").run(next);
    return next;
  },
};
