import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
delete process.env.STATION_TIME_ZONE; // these times assume the Asia/Kolkata default (UTC+05:30)
const { db } = await import("../db/client.js");
const { usersRepo } = await import("../repositories/users.js");
const { itemsRepo } = await import("../repositories/items.js");
const { shiftsRepo } = await import("../repositories/shifts.js");
const { closeDaySettingsRepo } = await import("../repositories/closeDaySettings.js");
const { closeDayCheck, closeBusinessDay, closeDaySummary } = await import("./closeDay.js");
const { createWalkInBill } = await import("./billing.js");
const { todayDateOnly } = await import("../repositories/stock.js");
const { businessToday } = await import("../repositories/businessDate.js");

usersRepo.create({ user_id: "ravi", name: "Ravi", password_hash: "x", role: "operator" });
itemsRepo.create({ code: "DSL", name: "DIESEL", price_wholesale: 90, price_retail: 90, purchase_value: 85, tax_percent: 0 });

test("settings default to any time and waiting for the date to change, and reject bad values", () => {
  // The default change-over is UTC midnight at the station (05:30 in India): unchanged behaviour.
  assert.deepEqual(closeDaySettingsRepo.get(), { min_close_time: null, next_date: "wait", day_changeover_time: "05:30" });
  assert.throws(() => closeDaySettingsRepo.set({ day_changeover_time: "25:00" }), /HH:MM/);
  assert.throws(() => closeDaySettingsRepo.set({ min_close_time: "9pm" }), /HH:MM/);
  assert.throws(() => closeDaySettingsRepo.set({ next_date: "today" as never }), /tomorrow/);
});

test("a date can't be closed before the minimum close time on that date, but can after midnight", () => {
  closeDaySettingsRepo.set({ min_close_time: "21:00" });
  // 15:00 UTC = 20:30 at the station
  assert.match(closeDayCheck("2026-11-28", new Date("2026-11-28T15:00:00Z")).reason ?? "", /from 21:00/);
  assert.equal(closeDayCheck("2026-11-28", new Date("2026-11-28T15:31:00Z")).allowed, true);
  // 01:30 on the 29th at the station: the 28th was left open and can still be closed.
  assert.equal(closeDayCheck("2026-11-28", new Date("2026-11-28T20:00:00Z")).allowed, true);
  closeDaySettingsRepo.set({ min_close_time: null });
});

test("a date that hasn't started at the station can't be closed", () => {
  assert.match(closeDayCheck("2026-11-29", new Date("2026-11-28T16:00:00Z")).reason ?? "", /hasn't started/);
});

test("'tomorrow straight away' moves billing on at once, and new bills still count in the open shift", () => {
  closeDaySettingsRepo.set({ next_date: "tomorrow" });
  const today = todayDateOnly();
  const tomorrow = (db.prepare("SELECT date(?, '+1 day') AS d").get(today) as { d: string }).d;
  // Mid-morning at the station on `today`, whatever the real clock says.
  const now = new Date(`${today}T06:00:00Z`);

  const shift = shiftsRepo.open("ravi", 0);
  const before = closeDaySummary(today, "ravi", now);
  assert.equal(before.next_date, tomorrow);
  assert.equal(before.next_date_open_now, true);

  const result = closeBusinessDay("ravi", now);
  assert.equal(result.closedDate, today);
  assert.equal(result.runningDate, tomorrow);

  const bill = createWalkInBill({ cashierId: "ravi", paymentType: "cash", lines: [{ item_code: "DSL", qty: 2 }] });
  assert.equal(bill.bill.bill_date.slice(0, 10), tomorrow);
  assert.equal(shiftsRepo.cashSalesSince("ravi", shift.opened_at), 180);

  // Tomorrow hasn't begun yet, so it can't be closed to push billing further ahead.
  assert.throws(() => closeBusinessDay("ravi", now), /hasn't started/);
  closeDaySettingsRepo.set({ next_date: "wait" });
});

test("the date change-over time decides when a new billing date starts and when the next date opens", () => {
  const at0130On29th = new Date("2026-11-28T20:00:00Z"); // 01:30 on the 29th at the station
  assert.equal(businessToday(at0130On29th), "2026-11-28", "before the default 05:30 change-over it's still the 28th");

  closeDaySettingsRepo.set({ day_changeover_time: "00:00" });
  assert.equal(businessToday(at0130On29th), "2026-11-29");
  assert.equal(closeDayCheck("2026-11-29", at0130On29th).allowed, true, "with a midnight change-over the 29th has begun");
  assert.match(closeDaySummary("2026-11-28", "ravi", at0130On29th).next_date_opens_at, /^29 Nov, 00:00$/);
  closeDaySettingsRepo.set({ day_changeover_time: "05:30" });
});
