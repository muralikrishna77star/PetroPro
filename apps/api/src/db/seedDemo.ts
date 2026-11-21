/**
 * Builds a fictional demo station, Green Valley Fuels, for screenshots, the public Product Tour and
 * sales demos. Every name, vehicle number and GSTIN here is made up. Never point this at a real
 * station's database: it refuses to run on one that already has bills.
 *
 *   DB_PATH=./data/demo.db npm run seed:demo --workspace apps/api
 *
 * The last DEMO_DAYS days get bills, purchases, receipts, mileage and closed stock days, through the
 * same services the app uses, so every report reads like a real station's. Today is left open, with
 * an open shift and attendant entries waiting for the cashier.
 */
import { db } from "./client.js";
import { usersRepo } from "../repositories/users.js";
import { groupsRepo } from "../repositories/groups.js";
import { itemsRepo } from "../repositories/items.js";
import { pumpsRepo } from "../repositories/pumps.js";
import { tenantsRepo } from "../repositories/tenants.js";
import { customersRepo } from "../repositories/customers.js";
import { vehiclesRepo } from "../repositories/vehicles.js";
import { pendingTransactionsRepo } from "../repositories/pendingTransactions.js";
import { rateChangesRepo } from "../repositories/rateChanges.js";
import { stockRepo, todayDateOnly } from "../repositories/stock.js";
import { hashPassword } from "../services/auth.js";
import { createWalkInBill } from "../services/billing.js";
import { recordPurchase } from "../services/purchasing.js";
import { recordReceipt, setOpeningBalance } from "../services/customerAccounts.js";
import { openShift, closeShift } from "../services/shifts.js";
import type { Role } from "@petropro/shared-types";

const DEMO_DAYS = 30;

if ((db.prepare("SELECT count(*) AS n FROM bills").get() as { n: number }).n > 0) {
  console.error("This database already has bills. The demo only goes into a new, empty database (set DB_PATH).");
  process.exit(1);
}

// Repeatable: the same demo every time, so screenshots can be retaken.
let seed = 20261121;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + random() * (max - min);
const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
const round2 = (n: number) => Math.round(n * 100) / 100;

function addDays(date: string, days: number): string {
  return (db.prepare("SELECT date(?, ?) AS d").get(date, `${days} day`) as { d: string }).d;
}

// --- Station ---------------------------------------------------------------------------------
tenantsRepo.update({
  name: "GREEN VALLEY FUELS",
  address_line1: "NH-44, Hosur Road, Krishnagiri - 635115",
  address_line2: "Ph: 98400 00000",
  tagline: "Authorised Fuel Dealer",
  gst_no: "33AAAAA0000A1Z5",
  payment_qr_code: null,
});

const users: [string, string, string, Role][] = [
  ["admin", "Station Owner", "admin123", "super_admin"],
  ["manager", "Meena R", "manager123", "owner"],
  ["cashier1", "Priya S", "cashier123", "operator"],
  ["cashier2", "Karthik M", "cashier123", "operator"],
  ["attendant1", "Suresh P", "attendant123", "field_operator"],
  ["attendant2", "Anand V", "attendant123", "field_operator"],
];
for (const [user_id, name, password, role] of users) {
  if (!usersRepo.getById(user_id)) usersRepo.create({ user_id, name, password_hash: hashPassword(password), role });
}

for (const [code, name] of [["F", "Fuel"], ["L", "Lubricants"], ["A", "Accessories"]]) {
  if (!groupsRepo.get(code)) groupsRepo.create({ code, name });
}

const ITEMS = [
  { code: "PET", name: "PETROL", group_code: "F", price: 101.2, cost: 97.1, tax: 0, mileage: true, hsn: "27101241" },
  { code: "DSL", name: "DIESEL", group_code: "F", price: 92.75, cost: 89.4, tax: 0, mileage: true, hsn: "27101944" },
  { code: "XP95", name: "PREMIUM PETROL 95", group_code: "F", price: 109.5, cost: 104.8, tax: 0, mileage: true, hsn: "27101241" },
  { code: "LEO1", name: "ENGINE OIL 1L", group_code: "L", price: 420, cost: 330, tax: 18, mileage: false, hsn: "27101980" },
  { code: "L2T", name: "2T OIL 500ML", group_code: "L", price: 145, cost: 110, tax: 18, mileage: false, hsn: "27101980" },
  { code: "LDEF", name: "DEF 20 LTR", group_code: "L", price: 1250, cost: 990, tax: 18, mileage: false, hsn: "31021000" },
  { code: "LCLT", name: "COOLANT 1L", group_code: "A", price: 260, cost: 190, tax: 18, mileage: false, hsn: "38200000" },
];
for (const i of ITEMS) {
  if (itemsRepo.get(i.code)) continue;
  itemsRepo.create({
    code: i.code,
    name: i.name,
    group_code: i.group_code,
    price_wholesale: i.price,
    price_retail: i.price,
    purchase_value: i.cost,
    track_mileage: i.mileage,
    tax_percent: i.tax,
    hsn_code: i.hsn,
  });
}

for (const [code, name] of [["P1", "Pump 1 - Petrol"], ["P2", "Pump 2 - Diesel"], ["P3", "Pump 3 - Petrol/Diesel"], ["P4", "Pump 4 - Premium"]]) {
  if (!pumpsRepo.get(code)) pumpsRepo.create({ code, name });
}

// --- Credit and fleet customers --------------------------------------------------------------
const CUSTOMERS = [
  { code: "C001", name: "Kaveri Roadlines Pvt Ltd", print: "KAVERI ROADLINES", limit: 1500000, opening: 84500, vehicles: 6, kind: "truck" },
  { code: "C002", name: "Hillside Travels", print: "HILLSIDE TRAVELS", limit: 900000, opening: 32100, vehicles: 4, kind: "bus" },
  { code: "C003", name: "Metro City Cabs", print: "METRO CITY CABS", limit: 600000, opening: 18750, vehicles: 8, kind: "car" },
  { code: "C004", name: "Sunfresh Agro Exports", print: "SUNFRESH AGRO", limit: 1200000, opening: 46200, vehicles: 3, kind: "truck" },
  { code: "C005", name: "Bluebell Public School", print: "BLUEBELL SCHOOL", limit: 500000, opening: 12400, vehicles: 3, kind: "bus" },
  { code: "C006", name: "Granite Works Co", print: "GRANITE WORKS", limit: 1000000, opening: 27900, vehicles: 4, kind: "truck" },
];

const fleet: { vehicle: string; customer: string; kind: string; odometer: number }[] = [];
const series = ["AB", "BC", "CD", "DK", "EZ", "AK", "BM", "CY"];
for (const c of CUSTOMERS) {
  if (!customersRepo.get(c.code)) {
    customersRepo.create({
      code: c.code,
      joined_on: "2024-04-01",
      name: c.name,
      address: "Krishnagiri",
      print_name: c.print,
      phone: null,
      credit_limit: c.limit,
      service_charge: 0,
      tin_no: null,
      gst_no: null,
      email: null,
    });
    setOpeningBalance({ customer_code: c.code, op_balance: c.opening, op_date: addDays(todayDateOnly(), -DEMO_DAYS - 1) });
  }
  for (let v = 0; v < c.vehicles; v++) {
    const vehicle = `TN${pick(["24", "70", "29", "19"])}${pick(series)}${String(1000 + Math.floor(random() * 8999))}`;
    if (!vehiclesRepo.get(vehicle)) vehiclesRepo.create({ vehicle_no: vehicle, customer_code: c.code, fleet_card: null });
    fleet.push({ vehicle, customer: c.code, kind: c.kind, odometer: Math.round(between(40000, 180000)) });
  }
}

// The fleet manager at Kaveri Roadlines uses the customer portal: statements, vehicles, mileage.
const portal = customersRepo.get("C001")!;
customersRepo.update("C001", { ...portal, email: "accounts@kaveriroadlines.example" });
customersRepo.setPasswordHash("C001", hashPassword("demo123"));

// --- Thirty days of trading ------------------------------------------------------------------
const today = todayDateOnly();
const start = addDays(today, -DEMO_DAYS);
const cashiers = ["cashier1", "cashier2"];
const setBusinessDate = (date: string) => db.prepare("UPDATE business_date SET running_date = ? WHERE id = 1").run(date);

/** A bill's time on the forecourt, as the station's clock and as UTC (bill_date is UTC). */
function stamp(date: string, minuteOfDay: number) {
  const local = `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}:${String(Math.floor(random() * 60)).padStart(2, "0")}`;
  const utc = (db.prepare("SELECT datetime(?, '-5 hours', '-30 minutes') AS t").get(`${date} ${local}`) as { t: string }).t;
  return { local, utc };
}

function retailSale(date: string, cashierId: string, minute: number) {
  const fuel = random() < 0.62 ? "PET" : random() < 0.85 ? "DSL" : "XP95";
  const rate = ITEMS.find((i) => i.code === fuel)!.price;
  // Two-wheelers buy by the rupee, cars by the litre or a round amount.
  const qty = random() < 0.45 ? round2(pick([100, 200, 300, 500]) / rate) : round2(between(5, fuel === "DSL" ? 45 : 30));
  const lines = [{ item_code: fuel, qty }];
  if (random() < 0.06) lines.push({ item_code: pick(["LEO1", "L2T", "LCLT"]), qty: 1 });
  const paymentType = pick(["cash", "cash", "cash", "upi", "upi", "card"]);
  const { bill } = createWalkInBill({ cashierId, paymentType, pumpCode: pick(["P1", "P3", "P4"]), lines });
  return { billNo: bill.bill_no, ...stamp(date, minute) };
}

function fleetSale(date: string, cashierId: string, minute: number) {
  const v = pick(fleet);
  const litres = v.kind === "car" ? round2(between(18, 40)) : v.kind === "bus" ? round2(between(60, 140)) : round2(between(80, 220));
  const kmPerLitre = v.kind === "car" ? between(13, 17) : v.kind === "bus" ? between(4, 5.5) : between(3.2, 4.6);
  const opening = v.odometer;
  v.odometer = Math.round(v.odometer + litres * kmPerLitre);
  const lines: { item_code: string; qty: number; odometer?: number; odometerOpening?: number }[] = [
    { item_code: v.kind === "car" && random() < 0.5 ? "PET" : "DSL", qty: litres, odometer: v.odometer, odometerOpening: opening },
  ];
  if (v.kind === "truck" && random() < 0.12) lines.push({ item_code: "LDEF", qty: 1 });
  const { bill } = createWalkInBill({
    cashierId,
    paymentType: "credit",
    customerCode: v.customer,
    vehicleNo: v.vehicle,
    orderNo: random() < 0.3 ? `PO-${Math.floor(between(1000, 9999))}` : null,
    pumpCode: "P2",
    lines,
  });
  return { billNo: bill.bill_no, ...stamp(date, minute) };
}

// Opening stock, so the first day's sales have something to come out of.
const dayBefore = addDays(start, -1);
setBusinessDate(dayBefore);
for (const [item, qty] of [["PET", 12000], ["DSL", 20000], ["XP95", 3000], ["LEO1", 60], ["L2T", 100], ["LDEF", 20], ["LCLT", 24]] as const) {
  recordPurchase({ item_code: item, qty, value: round2(qty * ITEMS.find((i) => i.code === item)!.cost), pur_date: dayBefore, invoice_no: "OPENING" });
}
stockRepo.closeDay(dayBefore);

let invoiceNo = 4100;
for (let d = 0; d < DEMO_DAYS; d++) {
  const date = addDays(start, d);
  setBusinessDate(date);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const busy = weekday === 0 ? 0.8 : weekday === 5 || weekday === 6 ? 1.15 : 1;

  // Tanker loads arrive in the morning, sized to what the station sells.
  if (d % 6 === 0) recordPurchase({ item_code: "DSL", qty: 12000, value: round2(12000 * 89.4), pur_date: date, invoice_no: `INV-${invoiceNo++}` });
  if (d % 8 === 1) recordPurchase({ item_code: "PET", qty: 6000, value: round2(6000 * 97.1), pur_date: date, invoice_no: `INV-${invoiceNo++}` });
  if (d === 15) recordPurchase({ item_code: "XP95", qty: 2000, value: round2(2000 * 104.8), pur_date: date, invoice_no: `INV-${invoiceNo++}` });
  if (d % 7 === 3) {
    recordPurchase({ item_code: "LEO1", qty: 24, value: round2(24 * 330), pur_date: date, invoice_no: `INV-${invoiceNo++}`, vat_amount: round2(24 * 330 * 0.18) });
    recordPurchase({ item_code: "LDEF", qty: 10, value: round2(10 * 990), pur_date: date, invoice_no: `INV-${invoiceNo++}`, vat_amount: round2(10 * 990 * 0.18) });
    recordPurchase({ item_code: "LCLT", qty: 24, value: round2(24 * 190), pur_date: date, invoice_no: `INV-${invoiceNo++}`, vat_amount: round2(24 * 190 * 0.18) });
  }

  const stamped: { billNo: number; local: string; utc: string }[] = [];
  const retail = Math.round(between(70, 95) * busy);
  const credit = Math.round(between(14, 24) * busy);
  // In time order, so bill numbers rise through the day as they do at a real counter.
  const minutes = Array.from({ length: retail + credit }, () => Math.round(between(6 * 60, 22 * 60))).sort((a, b) => a - b);
  for (const minute of minutes) {
    const cashierId = minute < 14 * 60 ? cashiers[0] : cashiers[1];
    stamped.push(random() < credit / (retail + credit) ? fleetSale(date, cashierId, minute) : retailSale(date, cashierId, minute));
  }
  for (const s of stamped) db.prepare("UPDATE bills SET bill_date = ?, local_time = ? WHERE bill_no = ?").run(s.utc, s.local, s.billNo);

  // Morning and evening shifts.
  for (const [cashierId, openAt, closeAt] of [["cashier1", 6 * 60, 14 * 60], ["cashier2", 14 * 60, 22 * 60]] as const) {
    const shift = openShift(cashierId, 5000);
    const opened = stamp(date, openAt).utc;
    const closedAt = stamp(date, closeAt).utc;
    db.prepare("UPDATE shifts SET opened_at = ? WHERE id = ?").run(opened, shift.id);
    const cash = db
      .prepare("SELECT COALESCE(SUM(grand_total), 0) AS t FROM bills WHERE user_id = ? AND payment_type = 'cash' AND bill_date BETWEEN ? AND ?")
      .get(cashierId, opened, closedAt) as { t: number };
    closeShift(shift.id, round2(5000 + cash.t - (random() < 0.15 ? Math.round(between(10, 120)) : 0)));
    db.prepare("UPDATE shifts SET closed_at = ? WHERE id = ?").run(closedAt, shift.id);
  }

  // Fleet customers pay every week or so.
  for (const c of CUSTOMERS) {
    const due = customersRepo.get(c.code)!.due_amount;
    if (random() < 0.2 && due > 20000) {
      const amount = Math.round((due * between(0.55, 0.85)) / 500) * 500;
      const r = recordReceipt({ customer_code: c.code, amount, mode: pick(["cheque", "neft", "neft", "cash"]), cashier_id: "cashier1" });
      db.prepare("UPDATE receipts SET rec_date = ? WHERE rec_no = ?").run(stamp(date, Math.round(between(10 * 60, 17 * 60))).utc, r.rec_no);
    }
  }

  stockRepo.closeDay(date);
}

// --- Today: open for business ----------------------------------------------------------------
setBusinessDate(today);
const now = new Date();
const minuteNow = Math.min(22 * 60, Math.max(7 * 60, (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440));
const morning = openShift("cashier1", 5000);
db.prepare("UPDATE shifts SET opened_at = ? WHERE id = ?").run(stamp(today, 6 * 60).utc, morning.id);
const todays: { billNo: number; local: string; utc: string }[] = [];
const todayMinutes = Array.from({ length: 64 }, () => Math.round(between(6 * 60, minuteNow))).sort((a, b) => a - b);
for (const [i, minute] of todayMinutes.entries()) {
  todays.push(i % 5 === 4 ? fleetSale(today, "cashier1", minute) : retailSale(today, "cashier1", minute));
}
for (const s of todays) db.prepare("UPDATE bills SET bill_date = ?, local_time = ? WHERE bill_no = ?").run(s.utc, s.local, s.billNo);

// Attendant entries waiting at the cashier's queue.
for (const [i, v] of fleet.slice(0, 4).entries()) {
  pendingTransactionsRepo.create({
    vehicle_no: v.vehicle,
    item_code: "DSL",
    qty: round2(between(60, 160)),
    odometer: v.odometer + Math.round(between(300, 600)),
    attendant_id: i % 2 ? "attendant2" : "attendant1",
    pump_code: "P2",
  });
}
for (const amount of [500, 1000]) {
  pendingTransactionsRepo.create({ vehicle_no: `TN24${pick(series)}${Math.floor(between(1000, 9999))}`, item_code: "PET", amount, attendant_id: "attendant1", pump_code: "P1" });
}

// A price revision the dealer has been told about.
rateChangesRepo.create({ item_code: "PET", rate: 101.45, scheduled_on: addDays(today, 2) });
rateChangesRepo.create({ item_code: "DSL", rate: 92.95, scheduled_on: addDays(today, 2) });

const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
console.log(
  `Demo station ready in ${db.location() ?? "memory"}: ${count("SELECT count(*) AS n FROM bills")} bills, ` +
    `${count("SELECT count(*) AS n FROM purchases")} purchases, ${count("SELECT count(*) AS n FROM receipts")} receipts, ` +
    `${count("SELECT count(*) AS n FROM pending_transactions WHERE status = 'pending'")} entries waiting. Sign in as admin / admin123.`,
);
