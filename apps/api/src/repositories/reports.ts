import { db } from "../db/client.js";
import type { Bill } from "./bills.js";

export type Granularity = "day" | "month" | "year";

function bucketExpr(column: string, granularity: Granularity): string {
  const format = granularity === "day" ? "%Y-%m-%d" : granularity === "month" ? "%Y-%m" : "%Y";
  return `strftime('${format}', ${column})`;
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
};
