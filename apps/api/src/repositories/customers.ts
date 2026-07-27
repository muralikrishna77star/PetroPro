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
  email: string | null;
}

export type CustomerWithAuth = Customer & { password_hash: string | null };

export type CustomerInput = Omit<Customer, "due_amount"> & { due_amount?: number };

/** Explicit column list (never `SELECT *`) so `password_hash` never rides along on a plain
 *  `get()`/`list()` and leaks into a JSON response the way `usersRepo` guards against too. */
const CUSTOMER_COLUMNS =
  "code, joined_on, name, address, print_name, phone, due_amount, credit_limit, service_charge, tin_no, gst_no, email";

export const customersRepo = {
  list(): Customer[] {
    return db
      .prepare(`SELECT ${CUSTOMER_COLUMNS} FROM customers ORDER BY code`)
      .all() as unknown as Customer[];
  },

  get(code: string): Customer | undefined {
    return db
      .prepare(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE code = ?`)
      .get(code) as Customer | undefined;
  },

  /** Includes `password_hash` — only for the customer login route, never returned as-is over the API. */
  getWithAuth(code: string): CustomerWithAuth | undefined {
    return db.prepare("SELECT * FROM customers WHERE code = ?").get(code) as CustomerWithAuth | undefined;
  },

  getByEmail(email: string): CustomerWithAuth | undefined {
    return db.prepare("SELECT * FROM customers WHERE email = ?").get(email) as CustomerWithAuth | undefined;
  },

  create(input: CustomerInput): Customer {
    db.prepare(
      `INSERT INTO customers (
        code, joined_on, name, address, print_name, phone, due_amount, credit_limit,
        service_charge, tin_no, gst_no, email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.email ?? null,
    );
    return customersRepo.get(input.code) as Customer;
  },

  update(code: string, input: Omit<CustomerInput, "code">): Customer | undefined {
    db.prepare(
      `UPDATE customers SET
        joined_on = ?, name = ?, address = ?, print_name = ?, phone = ?, credit_limit = ?,
        service_charge = ?, tin_no = ?, gst_no = ?, email = ?
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
      input.email ?? null,
      code,
    );
    return customersRepo.get(code);
  },

  setPasswordHash(code: string, passwordHash: string): void {
    db.prepare("UPDATE customers SET password_hash = ? WHERE code = ?").run(passwordHash, code);
  },

  adjustDueAmount(code: string, delta: number): void {
    db.prepare("UPDATE customers SET due_amount = due_amount + ? WHERE code = ?").run(delta, code);
  },

  setDueAmount(code: string, amount: number): void {
    db.prepare("UPDATE customers SET due_amount = ? WHERE code = ?").run(amount, code);
  },
};
