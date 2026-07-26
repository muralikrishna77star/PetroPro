import { db } from "../db/client.js";

export interface OpeningBalance {
  customer_code: string;
  op_date: string;
  op_balance: number;
}

export const openingBalancesRepo = {
  get(customerCode: string, opDate: string): OpeningBalance | undefined {
    return db
      .prepare("SELECT * FROM opening_balances WHERE customer_code = ? AND op_date = ?")
      .get(customerCode, opDate) as unknown as OpeningBalance | undefined;
  },

  /** Upserts the opening balance for a customer as of a date (typically set once, at
   *  onboarding/migration — see legacy OP_BAL). */
  set(input: OpeningBalance): OpeningBalance {
    db.prepare(
      `INSERT INTO opening_balances (customer_code, op_date, op_balance) VALUES (?, ?, ?)
       ON CONFLICT (customer_code, op_date) DO UPDATE SET op_balance = excluded.op_balance`,
    ).run(input.customer_code, input.op_date, input.op_balance);
    return openingBalancesRepo.get(input.customer_code, input.op_date) as OpeningBalance;
  },
};
