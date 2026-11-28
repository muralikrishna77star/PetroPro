import { db } from "../db/client.js";
import { config } from "../config.js";

/** What happens to billing once the current calendar date has been closed:
 *  - "tomorrow": billing moves straight on to the next date, so bills keyed in later that night
 *    post to tomorrow.
 *  - "wait": billing stays shut until the calendar date changes, then opens on the new date. */
export type NextDateMode = "tomorrow" | "wait";

export interface CloseDaySettings {
  /** Earliest station time ("HH:MM") a billing date can be closed on that date itself; null =
   *  any time. Doesn't hold back closing an earlier date that was left open. */
  min_close_time: string | null;
  next_date: NextDateMode;
  /** Station time ("HH:MM") the calendar date changes over for billing — when a closed day's
   *  next date opens under "wait", and when a new date counts as started. Defaults to the
   *  station-local time of UTC midnight (05:30 in India), which is how it always worked. */
  day_changeover_time: string;
}

// Stored in the same key/value `settings` table as the legacy YES/NO flags, under their own keys
// (repositories/settings.ts only reads its own SETTINGS_KEYS, so these never show up there).
const MIN_TIME_KEY = "CLOSEDAY_MIN_TIME";
const NEXT_DATE_KEY = "CLOSEDAY_NEXT_DATE";
const CHANGEOVER_KEY = "CLOSEDAY_CHANGEOVER_TIME";
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** UTC midnight in the station's time zone, e.g. "05:30" for Asia/Kolkata. */
function utcMidnightAtStation(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: config.stationTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date("2026-01-15T00:00:00Z"));
}

function read(key: string): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

function write(key: string, value: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}

export const closeDaySettingsRepo = {
  get(): CloseDaySettings {
    const minTime = read(MIN_TIME_KEY);
    const changeover = read(CHANGEOVER_KEY);
    return {
      min_close_time: minTime && TIME_PATTERN.test(minTime) ? minTime : null,
      // Defaults to how billing has always behaved: shut until the date changes.
      next_date: read(NEXT_DATE_KEY) === "tomorrow" ? "tomorrow" : "wait",
      day_changeover_time: changeover && TIME_PATTERN.test(changeover) ? changeover : utcMidnightAtStation(),
    };
  },

  /** Throws on a malformed value instead of storing it. */
  set(values: Partial<CloseDaySettings>): CloseDaySettings {
    if (values.min_close_time !== undefined) {
      const minTime = values.min_close_time ?? "";
      if (minTime !== "" && !TIME_PATTERN.test(minTime)) {
        throw new Error("Minimum close time must be HH:MM (24-hour), or empty for any time");
      }
      write(MIN_TIME_KEY, minTime);
    }
    if (values.next_date !== undefined) {
      if (values.next_date !== "tomorrow" && values.next_date !== "wait") {
        throw new Error('Next date must be "tomorrow" or "wait"');
      }
      write(NEXT_DATE_KEY, values.next_date);
    }
    if (values.day_changeover_time !== undefined) {
      if (!TIME_PATTERN.test(values.day_changeover_time)) {
        throw new Error("Date change-over time must be HH:MM (24-hour)");
      }
      write(CHANGEOVER_KEY, values.day_changeover_time);
    }
    return closeDaySettingsRepo.get();
  },
};
