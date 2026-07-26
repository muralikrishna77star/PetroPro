import { db } from "../db/client.js";

export interface LedgerEntry {
  date: string;
  type: "opening" | "bill" | "receipt" | "brought_forward";
  ref: string | number | null;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

interface RawEntry {
  date: string;
  type: "opening" | "bill" | "receipt";
  ref: string | number;
  description: string;
  debit: number;
  credit: number;
}

/**
 * Customer statement, computed on the fly from opening_balances (debit) + credit bills (debit)
 * + receipts (credit), chronologically, with a running balance. Not stored as its own table —
 * see docs/DATA_DICTIONARY.md's LEDGER note and db/schema.ts's comment on why.
 */
export function getCustomerLedger(customerCode: string, from?: string, to?: string): LedgerEntry[] {
  const openings = db
    .prepare("SELECT op_date, op_balance FROM opening_balances WHERE customer_code = ?")
    .all(customerCode) as unknown as { op_date: string; op_balance: number }[];

  const bills = db
    .prepare(
      `SELECT bill_no, bill_date, grand_total FROM bills
       WHERE customer_code = ? AND payment_type = 'credit' AND status != 'cancelled'`,
    )
    .all(customerCode) as unknown as { bill_no: number; bill_date: string; grand_total: number }[];

  const receipts = db
    .prepare("SELECT rec_no, rec_date, amount FROM receipts WHERE customer_code = ?")
    .all(customerCode) as unknown as { rec_no: number; rec_date: string; amount: number }[];

  const raw: RawEntry[] = [
    ...openings.map((o) => ({
      date: o.op_date,
      type: "opening" as const,
      ref: o.op_date,
      description: "Opening balance",
      debit: o.op_balance,
      credit: 0,
    })),
    ...bills.map((b) => ({
      date: b.bill_date,
      type: "bill" as const,
      ref: b.bill_no,
      description: `Credit bill #${b.bill_no}`,
      debit: b.grand_total,
      credit: 0,
    })),
    ...receipts.map((r) => ({
      date: r.rec_date,
      type: "receipt" as const,
      ref: r.rec_no,
      description: `Receipt #${r.rec_no}`,
      debit: 0,
      credit: r.amount,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const withBalance: LedgerEntry[] = raw.map((entry) => {
    running += entry.debit - entry.credit;
    return { ...entry, balance: running };
  });

  if (!from && !to) return withBalance;

  const datePart = (s: string) => s.slice(0, 10);
  const broughtForward = withBalance.filter((e) => !from || datePart(e.date) < from);
  const inRange = withBalance.filter(
    (e) => (!from || datePart(e.date) >= from) && (!to || datePart(e.date) <= to),
  );
  const carriedBalance = broughtForward.at(-1)?.balance ?? 0;

  return [
    {
      date: from ?? "",
      type: "brought_forward",
      ref: null,
      description: "Balance brought forward",
      debit: 0,
      credit: 0,
      balance: carriedBalance,
    },
    ...inRange,
  ];
}
