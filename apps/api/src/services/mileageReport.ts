import type { MileageReport, MileageReportRow } from "@petropro/shared-types";
import { db } from "../db/client.js";
import { customersRepo } from "../repositories/customers.js";
import { foxRound } from "./customerStatement.js";
import { moneyWords } from "./money.js";

/**
 * Petbill's "Sales & Mileage" reports: VWSMAGE for a vehicle, and magerep's MCWS for a customer. Both
 * are sales reports with mileage alongside, so they start from the bill lines and pick up a reading
 * where one exists. A line with no reading, such as oil, still counts towards the totals. Service
 * charge applies on the customer form only, as VWSMAGE has none.
 */
export interface MileageReportOptions {
  from: string;
  to: string;
  customerCode?: string;
  vehicleNo?: string;
  /** Legacy magerep compares under SET EXACT OFF, so a prefix. VWSMAGE asks: exactly like or containing. */
  vehicleMatch?: "prefix" | "exact" | "contains";
  creditOnly?: boolean;
}

function vehiclePattern(vehicleNo: string, match: NonNullable<MileageReportOptions["vehicleMatch"]>): string {
  const escaped = vehicleNo.toUpperCase().replace(/[\\%_]/g, "\\$&");
  if (match === "exact") return escaped;
  return match === "contains" ? `%${escaped}%` : `${escaped}%`;
}

export function getMileageReport(opts: MileageReportOptions): MileageReport {
  const vehicle = opts.vehicleNo?.trim() ?? "";
  const rows = db
    .prepare(
      `SELECT l.id, l.bill_no, date(b.bill_date) AS bill_date, b.order_no, b.vehicle_no, l.item_code,
              COALESCE(i.name, l.item_code) AS item_name, l.qty, l.rate, l.amount,
              m.odometer_prev, m.odometer_curr, m.mileage
       FROM bill_lines l
       JOIN bills b ON b.bill_no = l.bill_no
       LEFT JOIN items i ON i.code = l.item_code
       LEFT JOIN mileage_log m ON m.id = (
         SELECT max(id) FROM mileage_log WHERE bill_no = l.bill_no AND item_code = l.item_code
       )
       WHERE b.status != 'cancelled'
         AND date(b.bill_date) BETWEEN ? AND ?
         AND (? = '' OR b.customer_code = ?)
         AND (? = 0 OR b.payment_type = 'credit')
         AND (? = '' OR upper(b.vehicle_no) LIKE ? ESCAPE '\\')
       ORDER BY date(b.bill_date), b.bill_no, l.id`,
    )
    .all(
      opts.from,
      opts.to,
      opts.customerCode ?? "",
      opts.customerCode ?? "",
      opts.creditOnly ? 1 : 0,
      vehicle,
      vehicle ? vehiclePattern(vehicle, opts.vehicleMatch ?? "prefix") : "",
    ) as unknown as MileageReportRow[];

  const percent = opts.customerCode ? (customersRepo.get(opts.customerCode)?.service_charge ?? 0) : 0;
  const totalAmount = foxRound(rows.reduce((sum, r) => sum + r.amount, 0), 2);
  const serviceCharge = foxRound((totalAmount * percent) / 100, 2);
  const beforeRounding = foxRound(totalAmount + serviceCharge, 2);
  const netAmount = foxRound(beforeRounding, 0);

  return {
    from: opts.from,
    to: opts.to,
    vehicle_no: vehicle || null,
    rows,
    bill_count: new Set(rows.map((r) => r.bill_no)).size,
    total_qty: rows.reduce((sum, r) => sum + r.qty, 0),
    total_amount: totalAmount,
    service_charge_percent: percent,
    service_charge_amount: serviceCharge,
    round_off: foxRound(netAmount - beforeRounding, 2),
    net_amount: netAmount,
    amount_in_words: `${moneyWords(Math.abs(netAmount))} Rupees Only`.trim(),
  };
}
