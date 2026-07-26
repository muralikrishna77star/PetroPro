import { db } from "../db/client.js";

export interface PendingTransaction {
  id: number;
  vehicle_no: string;
  item_code: string;
  qty: number | null;
  amount: number | null;
  odometer: number | null;
  attendant_id: string;
  status: "pending" | "settled";
  bill_no: number | null;
  created_at: string;
  client_ref: string | null;
  pump_code: string | null;
}

export interface PendingTransactionInput {
  vehicle_no: string;
  item_code: string;
  qty?: number | null;
  amount?: number | null;
  odometer?: number | null;
  attendant_id: string;
  pump_code?: string | null;
  /** Client-generated UUID for offline-queue dedup — see routes/pendingTransactions.ts. Retrying
   *  a submission with the same client_ref after a dropped connection returns the original row
   *  instead of creating a duplicate. */
  client_ref?: string | null;
}

export const pendingTransactionsRepo = {
  listPending(): PendingTransaction[] {
    return db
      .prepare("SELECT * FROM pending_transactions WHERE status = 'pending' ORDER BY created_at")
      .all() as unknown as PendingTransaction[];
  },

  get(id: number): PendingTransaction | undefined {
    return db.prepare("SELECT * FROM pending_transactions WHERE id = ?").get(id) as
      | PendingTransaction
      | undefined;
  },

  getByClientRef(clientRef: string): PendingTransaction | undefined {
    return db.prepare("SELECT * FROM pending_transactions WHERE client_ref = ?").get(clientRef) as
      | PendingTransaction
      | undefined;
  },

  create(input: PendingTransactionInput): PendingTransaction {
    const result = db
      .prepare(
        `INSERT INTO pending_transactions (vehicle_no, item_code, qty, amount, odometer, attendant_id, client_ref, pump_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.vehicle_no,
        input.item_code,
        input.qty ?? null,
        input.amount ?? null,
        input.odometer ?? null,
        input.attendant_id,
        input.client_ref ?? null,
        input.pump_code ?? null,
      );
    return pendingTransactionsRepo.get(Number(result.lastInsertRowid)) as PendingTransaction;
  },

  markSettled(id: number, billNo: number): void {
    db.prepare("UPDATE pending_transactions SET status = 'settled', bill_no = ? WHERE id = ?").run(
      billNo,
      id,
    );
  },
};
