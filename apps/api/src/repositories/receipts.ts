import { db } from "../db/client.js";

export interface Receipt {
  rec_no: number;
  rec_date: string;
  customer_code: string;
  amount: number;
  mode: string;
  cheque_no: string | null;
  bank_name: string | null;
  service_charge: number;
  cashier_id: string | null;
}

export interface ReceiptInput {
  customer_code: string;
  amount: number;
  mode: string;
  cheque_no?: string | null;
  bank_name?: string | null;
  service_charge?: number;
  cashier_id: string;
}

export const receiptsRepo = {
  get(recNo: number): Receipt | undefined {
    return db.prepare("SELECT * FROM receipts WHERE rec_no = ?").get(recNo) as unknown as Receipt | undefined;
  },

  listByCustomer(customerCode: string): Receipt[] {
    return db
      .prepare("SELECT * FROM receipts WHERE customer_code = ? ORDER BY rec_date DESC")
      .all(customerCode) as unknown as Receipt[];
  },

  create(input: ReceiptInput): Receipt {
    const result = db
      .prepare(
        `INSERT INTO receipts (customer_code, amount, mode, cheque_no, bank_name, service_charge, cashier_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.customer_code,
        input.amount,
        input.mode,
        input.cheque_no ?? null,
        input.bank_name ?? null,
        input.service_charge ?? 0,
        input.cashier_id,
      );
    return db
      .prepare("SELECT * FROM receipts WHERE rec_no = ?")
      .get(Number(result.lastInsertRowid)) as unknown as Receipt;
  },
};
