import { db } from "../db/client.js";

export interface Purchase {
  id: number;
  item_code: string;
  qty: number;
  value: number;
  pur_date: string;
  invoice_no: string | null;
  vat_amount: number;
}

export interface PurchaseInput {
  item_code: string;
  qty: number;
  value: number;
  pur_date?: string;
  invoice_no?: string | null;
  vat_amount?: number;
}

export const purchasesRepo = {
  list(itemCode?: string): Purchase[] {
    if (itemCode) {
      return db
        .prepare("SELECT * FROM purchases WHERE item_code = ? ORDER BY pur_date DESC")
        .all(itemCode) as unknown as Purchase[];
    }
    return db.prepare("SELECT * FROM purchases ORDER BY pur_date DESC").all() as unknown as Purchase[];
  },

  listRange(from: string, to: string, itemCode?: string): Purchase[] {
    if (itemCode) {
      return db
        .prepare(
          "SELECT * FROM purchases WHERE item_code = ? AND date(pur_date) BETWEEN ? AND ? ORDER BY pur_date",
        )
        .all(itemCode, from, to) as unknown as Purchase[];
    }
    return db
      .prepare("SELECT * FROM purchases WHERE date(pur_date) BETWEEN ? AND ? ORDER BY pur_date")
      .all(from, to) as unknown as Purchase[];
  },

  create(input: PurchaseInput): Purchase {
    const result = input.pur_date
      ? db
          .prepare(
            `INSERT INTO purchases (item_code, qty, value, pur_date, invoice_no, vat_amount)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(input.item_code, input.qty, input.value, input.pur_date, input.invoice_no ?? null, input.vat_amount ?? 0)
      : db
          .prepare(
            `INSERT INTO purchases (item_code, qty, value, invoice_no, vat_amount)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(input.item_code, input.qty, input.value, input.invoice_no ?? null, input.vat_amount ?? 0);

    return db
      .prepare("SELECT * FROM purchases WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as unknown as Purchase;
  },
};
