import { db } from "../db/client.js";
import type { Bill } from "./bills.js";

export type Granularity = "day" | "week" | "month" | "quarter" | "half-year" | "year";

/** Quarter/half-year have no native strftime code, so they're built from the month number:
 *  months 1-3/4-6/7-9/10-12 -> Q1-Q4 (integer division floors for positive ints in SQLite). */
function bucketExpr(column: string, granularity: Granularity): string {
  switch (granularity) {
    case "day":
      return `strftime('%Y-%m-%d', ${column})`;
    case "week":
      return `strftime('%Y-W%W', ${column})`;
    case "month":
      return `strftime('%Y-%m', ${column})`;
    case "quarter":
      return `(strftime('%Y', ${column}) || '-Q' || ((CAST(strftime('%m', ${column}) AS INTEGER) - 1) / 3 + 1))`;
    case "half-year":
      return `(strftime('%Y', ${column}) || '-H' || ((CAST(strftime('%m', ${column}) AS INTEGER) - 1) / 6 + 1))`;
    case "year":
      return `strftime('%Y', ${column})`;
  }
}

export interface ItemSalesRow {
  bucket: string;
  item_code: string;
  item_name: string;
  qty: number;
  amount: number;
  tax_amount: number;
}

export interface CashierSalesRow {
  bucket: string;
  user_id: string;
  cashier_name: string;
  bill_count: number;
  amount: number;
}

export interface GroupSalesRow {
  bucket: string;
  group_code: string | null;
  group_name: string | null;
  qty: number;
  amount: number;
  tax_amount: number;
}

/** Item-level rows carrying their group, so the report page can nest items beneath each group
 *  and roll up the group subtotal client-side from the same rows — one query instead of two. */
export interface GroupItemSalesRow {
  bucket: string;
  group_code: string | null;
  group_name: string | null;
  item_code: string;
  item_name: string;
  qty: number;
  amount: number;
  tax_amount: number;
}

export interface VehicleSalesRow {
  vehicle_no: string;
  bill_count: number;
  amount: number;
}

export interface FleetCardSalesRow {
  fleet_card: string;
  bill_count: number;
  amount: number;
}

export interface GstSummaryRow {
  bucket: string;
  tax_percent: number;
  taxable_value: number;
  tax_amount: number;
  total: number;
}

export interface StockSummaryRow {
  bucket: string;
  item_code: string;
  item_name: string;
  opening: number;
  purchases: number;
  consumption: number;
  closing: number;
}

export const reportsRepo = {
  salesByItem(from: string, to: string, granularity: Granularity): ItemSalesRow[] {
    const bucket = bucketExpr("b.bill_date", granularity);
    return db
      .prepare(
        `SELECT ${bucket} AS bucket, bl.item_code, i.name AS item_name,
                SUM(bl.qty) AS qty, SUM(bl.amount) AS amount, SUM(bl.tax_amount) AS tax_amount
         FROM bill_lines bl
         JOIN bills b ON b.bill_no = bl.bill_no
         JOIN items i ON i.code = bl.item_code
         WHERE b.status != 'cancelled' AND date(b.bill_date) BETWEEN ? AND ?
         GROUP BY bl.item_code, bucket
         ORDER BY bucket, bl.item_code`,
      )
      .all(from, to) as unknown as ItemSalesRow[];
  },

  salesByCashier(from: string, to: string, granularity: Granularity): CashierSalesRow[] {
    const bucket = bucketExpr("b.bill_date", granularity);
    return db
      .prepare(
        `SELECT ${bucket} AS bucket, b.user_id, u.name AS cashier_name,
                COUNT(*) AS bill_count, SUM(b.grand_total) AS amount
         FROM bills b
         JOIN users u ON u.user_id = b.user_id
         WHERE b.status != 'cancelled' AND date(b.bill_date) BETWEEN ? AND ?
         GROUP BY b.user_id, bucket
         ORDER BY bucket, b.user_id`,
      )
      .all(from, to) as unknown as CashierSalesRow[];
  },

  salesByGroup(from: string, to: string, granularity: Granularity): GroupSalesRow[] {
    const bucket = bucketExpr("b.bill_date", granularity);
    return db
      .prepare(
        `SELECT ${bucket} AS bucket, i.group_code, g.name AS group_name,
                SUM(bl.qty) AS qty, SUM(bl.amount) AS amount, SUM(bl.tax_amount) AS tax_amount
         FROM bill_lines bl
         JOIN bills b ON b.bill_no = bl.bill_no
         JOIN items i ON i.code = bl.item_code
         LEFT JOIN groups g ON g.code = i.group_code
         WHERE b.status != 'cancelled' AND date(b.bill_date) BETWEEN ? AND ?
         GROUP BY i.group_code, bucket
         ORDER BY bucket, i.group_code`,
      )
      .all(from, to) as unknown as GroupSalesRow[];
  },

  salesByGroupItems(from: string, to: string, granularity: Granularity): GroupItemSalesRow[] {
    const bucket = bucketExpr("b.bill_date", granularity);
    return db
      .prepare(
        `SELECT ${bucket} AS bucket, i.group_code, g.name AS group_name, bl.item_code, i.name AS item_name,
                SUM(bl.qty) AS qty, SUM(bl.amount) AS amount, SUM(bl.tax_amount) AS tax_amount
         FROM bill_lines bl
         JOIN bills b ON b.bill_no = bl.bill_no
         JOIN items i ON i.code = bl.item_code
         LEFT JOIN groups g ON g.code = i.group_code
         WHERE b.status != 'cancelled' AND date(b.bill_date) BETWEEN ? AND ?
         GROUP BY i.group_code, bl.item_code, bucket
         ORDER BY bucket, i.group_code, bl.item_code`,
      )
      .all(from, to) as unknown as GroupItemSalesRow[];
  },

  /** Bill register — the "bill-wise" report is simply the filtered list of bills for a period. */
  billRegister(from: string, to: string, status?: string): Bill[] {
    if (status) {
      return db
        .prepare("SELECT * FROM bills WHERE date(bill_date) BETWEEN ? AND ? AND status = ? ORDER BY bill_date")
        .all(from, to, status) as unknown as Bill[];
    }
    return db
      .prepare("SELECT * FROM bills WHERE date(bill_date) BETWEEN ? AND ? ORDER BY bill_date")
      .all(from, to) as unknown as Bill[];
  },

  vehicleSales(from: string, to: string): VehicleSalesRow[] {
    return db
      .prepare(
        `SELECT vehicle_no, COUNT(*) AS bill_count, SUM(grand_total) AS amount
         FROM bills
         WHERE status != 'cancelled' AND vehicle_no IS NOT NULL AND date(bill_date) BETWEEN ? AND ?
         GROUP BY vehicle_no
         ORDER BY amount DESC`,
      )
      .all(from, to) as unknown as VehicleSalesRow[];
  },

  fleetCardSales(from: string, to: string): FleetCardSalesRow[] {
    return db
      .prepare(
        `SELECT v.fleet_card AS fleet_card, COUNT(*) AS bill_count, SUM(b.grand_total) AS amount
         FROM bills b
         JOIN vehicles v ON v.vehicle_no = b.vehicle_no
         WHERE v.fleet_card IS NOT NULL AND b.status != 'cancelled' AND date(b.bill_date) BETWEEN ? AND ?
         GROUP BY v.fleet_card
         ORDER BY amount DESC`,
      )
      .all(from, to) as unknown as FleetCardSalesRow[];
  },

  gstSummary(from: string, to: string, granularity: Granularity): GstSummaryRow[] {
    const bucket = bucketExpr("b.bill_date", granularity);
    return db
      .prepare(
        `SELECT ${bucket} AS bucket, bl.tax_percent,
                SUM(bl.amount - bl.tax_amount) AS taxable_value,
                SUM(bl.tax_amount) AS tax_amount,
                SUM(bl.amount) AS total
         FROM bill_lines bl
         JOIN bills b ON b.bill_no = bl.bill_no
         WHERE b.status != 'cancelled' AND date(b.bill_date) BETWEEN ? AND ?
         GROUP BY bucket, bl.tax_percent
         ORDER BY bucket, bl.tax_percent`,
      )
      .all(from, to) as unknown as GstSummaryRow[];
  },

  /** Opening/purchases/consumption/closing per item, bucketed by period — unlike stockRepo's raw
   *  per-day rows (which carry a running `balance` the dashboard depends on and are left alone),
   *  opening/closing here are the first/last day's values *within the bucket*, not summed, since
   *  they're running balances rather than period totals (see the window-function CTE below). */
  stockSummary(from: string, to: string, granularity: Granularity, itemCode?: string): StockSummaryRow[] {
    const bucket = bucketExpr("sd.sdate", granularity);
    const itemFilter = itemCode ? "AND sd.item_code = ?" : "";
    const params = itemCode ? [from, to, itemCode] : [from, to];
    return db
      .prepare(
        `WITH ordered AS (
           SELECT sd.item_code, sd.sdate, sd.opening, sd.receipts, sd.sales, sd.closing,
                  ${bucket} AS bucket,
                  ROW_NUMBER() OVER (PARTITION BY sd.item_code, ${bucket} ORDER BY sd.sdate ASC) AS rn_asc,
                  ROW_NUMBER() OVER (PARTITION BY sd.item_code, ${bucket} ORDER BY sd.sdate DESC) AS rn_desc
           FROM stock_daybook sd
           WHERE sd.sdate BETWEEN ? AND ? ${itemFilter}
         )
         SELECT o.bucket, o.item_code, i.name AS item_name,
                MAX(CASE WHEN o.rn_asc = 1 THEN o.opening END) AS opening,
                SUM(o.receipts) AS purchases,
                SUM(o.sales) AS consumption,
                MAX(CASE WHEN o.rn_desc = 1 THEN o.closing END) AS closing
         FROM ordered o
         JOIN items i ON i.code = o.item_code
         GROUP BY o.item_code, o.bucket
         ORDER BY o.bucket, o.item_code`,
      )
      .all(...params) as unknown as StockSummaryRow[];
  },
};
