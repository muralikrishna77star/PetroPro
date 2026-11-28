import { db } from "../db/client.js";
import { usersRepo } from "../repositories/users.js";
import { stockRepo } from "../repositories/stock.js";
import { businessDateRepo, businessToday } from "../repositories/businessDate.js";
import { closeDaySettingsRepo, type NextDateMode } from "../repositories/closeDaySettings.js";
import { config } from "../config.js";

export interface ItemSales {
  item_code: string;
  item_name: string;
  qty: number;
  amount: number;
}

export interface SalesTotals {
  bill_count: number;
  amount: number;
  items: ItemSales[];
}

export interface CloseDaySummary {
  /** The business date being (or just) closed. */
  date: string;
  /** The day billing moves on to once `date` is closed. */
  next_date: string;
  next_date_mode: NextDateMode;
  /** False when billing stays shut after closing (closing today's date with the "wait" setting)
   *  until the calendar reaches `next_date`. */
  next_date_open_now: boolean;
  /** When `next_date` opens for billing, in the station's own time (Close Day's date change-over
   *  time, 05:30 by default in India). */
  next_date_opens_at: string;
  /** Whether `date` can be closed right now, and if not, why (the minimum close time setting,
   *  or a date that hasn't begun yet). */
  can_close: boolean;
  close_blocked_reason: string | null;
  min_close_time: string | null;
  /** Every non-cancelled bill posted on `date`, by any cashier. */
  day: SalesTotals;
  /** Just the bills the closing cashier entered on `date`. */
  cashier: SalesTotals & { user_id: string; name: string };
}

function salesFor(date: string, userId?: string): SalesTotals {
  const userFilter = userId === undefined ? "" : "AND b.user_id = ?";
  const params = userId === undefined ? [date] : [date, userId];
  const items = db
    .prepare(
      `SELECT bl.item_code, COALESCE(i.name, bl.item_code) AS item_name,
              ROUND(SUM(bl.qty), 3) AS qty, ROUND(SUM(bl.amount), 2) AS amount
         FROM bill_lines bl
         JOIN bills b ON b.bill_no = bl.bill_no
         LEFT JOIN items i ON i.code = bl.item_code
        WHERE substr(b.bill_date, 1, 10) = ? AND b.status <> 'cancelled' ${userFilter}
        GROUP BY bl.item_code
        ORDER BY amount DESC`,
    )
    .all(...params) as unknown as ItemSales[];
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS bill_count, ROUND(COALESCE(SUM(b.grand_total), 0), 2) AS amount
         FROM bills b
        WHERE substr(b.bill_date, 1, 10) = ? AND b.status <> 'cancelled' ${userFilter}`,
    )
    .get(...params) as { bill_count: number; amount: number };
  return { ...totals, items };
}

/** The station's local date and time ("YYYY-MM-DD", "HH:MM") at `now`. */
function stationClock(now: Date): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: config.stationTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Whether billing date `date` can be closed at `now`. A date that hasn't begun at the station
 *  can't be closed (this is what stops "tomorrow straight away" running further ahead), and with a
 *  minimum close time set, a date can't be closed until that time on the date itself. An earlier
 *  date that was left open can always be closed. */
export function closeDayCheck(date: string, now = new Date()): { allowed: boolean; reason: string | null } {
  const station = stationClock(now);
  if (date > businessToday(now)) {
    return { allowed: false, reason: `${date} hasn't started yet, so it can't be closed.` };
  }
  const { min_close_time } = closeDaySettingsRepo.get();
  if (min_close_time && `${station.date} ${station.time}` < `${date} ${min_close_time}`) {
    return { allowed: false, reason: `${date} can be closed from ${min_close_time}.` };
  }
  return { allowed: true, reason: null };
}

/** What Close Day shows before and after closing `date`: the day's sales by item (qty and
 *  value), the same for the cashier closing it, the day billing moves on to, and whether it can
 *  be closed yet. */
export function closeDaySummary(date: string, userId: string, now = new Date()): CloseDaySummary {
  const nextDate = (db.prepare("SELECT date(?, '+1 day') AS d").get(date) as { d: string }).d;
  const settings = closeDaySettingsRepo.get();
  const check = closeDayCheck(date, now);
  return {
    date,
    next_date: nextDate,
    next_date_mode: settings.next_date,
    next_date_open_now: settings.next_date === "tomorrow" || nextDate <= businessToday(now),
    next_date_opens_at: `${new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(
      new Date(`${nextDate}T12:00:00Z`),
    )}, ${settings.day_changeover_time}`,
    can_close: check.allowed,
    close_blocked_reason: check.reason,
    min_close_time: settings.min_close_time,
    day: salesFor(date),
    cashier: { user_id: userId, name: usersRepo.getById(userId)?.name ?? userId, ...salesFor(date, userId) },
  };
}

/** Closes the current running business date and moves billing on (see businessDateRepo.advance).
 *  Throws, closing nothing, when the date can't be closed yet. */
export function closeBusinessDay(userId: string, now = new Date()) {
  const closedDate = businessDateRepo.get();
  const check = closeDayCheck(closedDate, now);
  if (!check.allowed) throw new Error(check.reason ?? `${closedDate} can't be closed yet.`);
  const rowsClosed = stockRepo.closeDay(closedDate);
  const runningDate = businessDateRepo.advance();
  // The closed day's final figures, for the "day closed" dialog. A closed day takes no more
  // bills, so these can't change afterwards.
  return { closedDate, rowsClosed, runningDate, summary: closeDaySummary(closedDate, userId, now) };
}
