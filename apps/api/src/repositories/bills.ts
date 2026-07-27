import { db } from "../db/client.js";

export interface Bill {
  bill_no: number;
  bill_date: string;
  vehicle_no: string | null;
  customer_code: string | null;
  user_id: string | null;
  sub_total: number;
  tax_total: number;
  grand_total: number;
  payment_type: string;
  status: string;
  cancelled_by: string | null;
  cancelled_at: string | null;
  order_no: string | null;
  pump_code: string | null;
}

export interface BillLine {
  id: number;
  bill_no: number;
  item_code: string;
  qty: number;
  rate: number;
  rate_pretax: number;
  amount: number;
  tax_percent: number;
  tax_amount: number;
  is_retail: number;
  service_charge: number;
  order_line_id: number | null;
}

export interface NewBillLine {
  item_code: string;
  qty: number;
  rate: number;
  rate_pretax: number;
  amount: number;
  tax_percent: number;
  tax_amount: number;
  is_retail?: boolean;
  service_charge?: number;
  /** Set when this line fulfills part of a customer's pending order (services/orders.ts). */
  order_line_id?: number | null;
}

export interface NewBill {
  vehicle_no?: string | null;
  customer_code?: string | null;
  user_id: string;
  payment_type: string;
  order_no?: string | null;
  pump_code?: string | null;
  /** Defaults to the DB's `datetime('now')` when omitted (see schema.ts) — pass explicitly to
   *  stamp a bill against the running business date rather than the wall-clock date. */
  bill_date?: string;
  lines: NewBillLine[];
}

export const billsRepo = {
  get(billNo: number): Bill | undefined {
    return db.prepare("SELECT * FROM bills WHERE bill_no = ?").get(billNo) as Bill | undefined;
  },

  getLines(billNo: number): BillLine[] {
    return db.prepare("SELECT * FROM bill_lines WHERE bill_no = ? ORDER BY id").all(billNo) as unknown as BillLine[];
  },

  /** Creates a bill + its lines as a single unit. Not wrapped in an app-level transaction
   *  helper because node:sqlite's DatabaseSync has no transaction() API — BEGIN/COMMIT are
   *  issued directly so a failed line insert rolls back the whole bill. */
  create(input: NewBill): Bill {
    const subTotal = input.lines.reduce((sum, l) => sum + l.amount - l.tax_amount, 0);
    const taxTotal = input.lines.reduce((sum, l) => sum + l.tax_amount, 0);
    const grandTotal = subTotal + taxTotal;

    db.exec("BEGIN");
    try {
      const billResult = input.bill_date
        ? db
            .prepare(
              `INSERT INTO bills (vehicle_no, customer_code, user_id, sub_total, tax_total, grand_total, payment_type, order_no, pump_code, bill_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              input.vehicle_no ?? null,
              input.customer_code ?? null,
              input.user_id,
              subTotal,
              taxTotal,
              grandTotal,
              input.payment_type,
              input.order_no ?? null,
              input.pump_code ?? null,
              input.bill_date,
            )
        : db
            .prepare(
              `INSERT INTO bills (vehicle_no, customer_code, user_id, sub_total, tax_total, grand_total, payment_type, order_no, pump_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              input.vehicle_no ?? null,
              input.customer_code ?? null,
              input.user_id,
              subTotal,
              taxTotal,
              grandTotal,
              input.payment_type,
              input.order_no ?? null,
              input.pump_code ?? null,
            );
      const billNo = Number(billResult.lastInsertRowid);

      const insertLine = db.prepare(
        `INSERT INTO bill_lines (
          bill_no, item_code, qty, rate, rate_pretax, amount, tax_percent, tax_amount, is_retail, service_charge, order_line_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const line of input.lines) {
        insertLine.run(
          billNo,
          line.item_code,
          line.qty,
          line.rate,
          line.rate_pretax,
          line.amount,
          line.tax_percent,
          line.tax_amount,
          line.is_retail === false ? 0 : 1,
          line.service_charge ?? 0,
          line.order_line_id ?? null,
        );
      }

      db.exec("COMMIT");
      return billsRepo.get(billNo) as Bill;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  },

  /** Legacy BILLCNCS: cancellation marks the bill status='C' (here 'cancelled') plus a
   *  cancelling-user + timestamp audit trail; the original bill/lines are kept, not deleted. */
  cancel(billNo: number, cancelledBy: string): Bill | undefined {
    db.prepare(
      `UPDATE bills SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now')
       WHERE bill_no = ?`,
    ).run(cancelledBy, billNo);
    return billsRepo.get(billNo);
  },

  /** Legacy PREVBILL: last-bill lookup for duplicate/reprint, optionally scoped to a vehicle
   *  or customer. */
  getLast(filter: { vehicleNo?: string; customerCode?: string } = {}): Bill | undefined {
    if (filter.vehicleNo) {
      return db
        .prepare("SELECT * FROM bills WHERE vehicle_no = ? ORDER BY bill_no DESC LIMIT 1")
        .get(filter.vehicleNo) as Bill | undefined;
    }
    if (filter.customerCode) {
      return db
        .prepare("SELECT * FROM bills WHERE customer_code = ? ORDER BY bill_no DESC LIMIT 1")
        .get(filter.customerCode) as Bill | undefined;
    }
    return db.prepare("SELECT * FROM bills ORDER BY bill_no DESC LIMIT 1").get() as Bill | undefined;
  },

  /** Most recent N bills (headers only, no lines) — powers the billing screen's "recent bills"
   *  reference panel, so a cashier can glance back without leaving the entry screen. */
  listRecent(limit: number): Bill[] {
    return db.prepare("SELECT * FROM bills ORDER BY bill_no DESC LIMIT ?").all(limit) as unknown as Bill[];
  },
};
