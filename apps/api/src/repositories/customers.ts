import { db } from "../db/client.js";

export interface Customer {
  code: string;
  joined_on: string | null;
  name: string;
  address: string | null;
  print_name: string | null;
  phone: string | null;
  due_amount: number;
  credit_limit: number;
  service_charge: number;
  tin_no: string | null;
  gst_no: string | null;
}

export type CustomerInput = Omit<Customer, "due_amount"> & { due_amount?: number };

export const customersRepo = {
  list(): Customer[] {
    return db.prepare("SELECT * FROM customers ORDER BY code").all() as unknown as Customer[];
  },

  get(code: string): Customer | undefined {
    return db.prepare("SELECT * FROM customers WHERE code = ?").get(code) as Customer | undefined;
  },

  create(input: CustomerInput): Customer {
    db.prepare(
      `INSERT INTO customers (
        code, joined_on, name, address, print_name, phone, due_amount, credit_limit,
        service_charge, tin_no, gst_no
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.code,
      input.joined_on ?? null,
      input.name,
      input.address ?? null,
      input.print_name ?? null,
      input.phone ?? null,
      input.due_amount ?? 0,
      input.credit_limit ?? 0,
      input.service_charge ?? 0,
      input.tin_no ?? null,
      input.gst_no ?? null,
    );
    return customersRepo.get(input.code) as Customer;
  },

  update(code: string, input: Omit<CustomerInput, "code">): Customer | undefined {
    db.prepare(
      `UPDATE customers SET
        joined_on = ?, name = ?, address = ?, print_name = ?, phone = ?, credit_limit = ?,
        service_charge = ?, tin_no = ?, gst_no = ?
      WHERE code = ?`,
    ).run(
      input.joined_on ?? null,
      input.name,
      input.address ?? null,
      input.print_name ?? null,
      input.phone ?? null,
      input.credit_limit ?? 0,
      input.service_charge ?? 0,
      input.tin_no ?? null,
      input.gst_no ?? null,
      code,
    );
    return customersRepo.get(code);
  },

  adjustDueAmount(code: string, delta: number): void {
    db.prepare("UPDATE customers SET due_amount = due_amount + ? WHERE code = ?").run(delta, code);
  },

  setDueAmount(code: string, amount: number): void {
    db.prepare("UPDATE customers SET due_amount = ? WHERE code = ?").run(amount, code);
  },
};
