import { itemsRepo } from "../repositories/items.js";
import { vehiclesRepo } from "../repositories/vehicles.js";
import { pendingTransactionsRepo } from "../repositories/pendingTransactions.js";
import { billsRepo, type Bill, type BillLine, type NewBillLine } from "../repositories/bills.js";
import { customersRepo } from "../repositories/customers.js";
import { stockRepo } from "../repositories/stock.js";
import { businessDateRepo } from "../repositories/businessDate.js";
import { mileageRepo } from "../repositories/mileage.js";
import { ordersRepo } from "../repositories/orders.js";
import { lineTotal } from "./tax.js";
import { amountInWords } from "./money.js";

export interface ExtraLineInput {
  item_code: string;
  qty: number;
  is_retail?: boolean;
}

export interface SettleInput {
  pendingId: number;
  cashierId: string;
  paymentType: string;
  extraLines?: ExtraLineInput[];
}

export interface WalkInLineInput {
  item_code: string;
  qty: number;
  /** Closing odometer reading (litres filled = qty). Paired with `odometerOpening` when the
   *  cashier records both readings for a single tank-fill; otherwise mileage falls back to the
   *  vehicle's last recorded reading (see mileageRepo.record). */
  odometer?: number;
  odometerOpening?: number;
  /** Set when this line is drawn against a specific line of a customer's pending order (a
   *  wholly different concept from `orderNo` below — see `fulfillOrderNo`). */
  orderLineId?: number;
}

export interface WalkInBillInput {
  cashierId: string;
  paymentType: string;
  customerCode?: string | null;
  vehicleNo?: string | null;
  /** Free-text credit-sale PO reference, printed on the invoice — unrelated to `fulfillOrderNo`. */
  orderNo?: string | null;
  /** Which of the customer's pending orders (repositories/orders.ts) this bill fulfills, if any. */
  fulfillOrderNo?: number;
  pumpCode?: string | null;
  lines: WalkInLineInput[];
}

export interface BillResult {
  bill: Bill;
  lines: BillLine[];
  amountInWords: string;
}

export type SettleResult = BillResult;

function applyStockForSale(lines: NewBillLine[], date: string): void {
  for (const line of lines) {
    stockRepo.applySale(line.item_code, line.qty, date);
  }
}

/** Stamps a bill with the running business date (see repositories/businessDate.ts) plus the
 *  actual time of entry, rather than the wall-clock date — so bills always post against the
 *  day that's currently open, even if it lags behind the real calendar date. */
function billTimestamp(businessDate: string): string {
  const time = new Date().toISOString().slice(11, 19);
  return `${businessDate} ${time}`;
}

function buildLine(itemCode: string, qty: number, orderLineId?: number): NewBillLine {
  const item = itemsRepo.get(itemCode);
  if (!item) throw new Error(`Unknown item code: ${itemCode}`);
  const rate = item.price_retail;
  const totals = lineTotal(qty, rate, item.tax_percent);
  return {
    item_code: itemCode,
    qty,
    rate: totals.rate,
    rate_pretax: totals.ratePretax,
    amount: totals.amount,
    tax_percent: totals.taxPercent,
    tax_amount: totals.taxAmount,
    is_retail: true,
    order_line_id: orderLineId ?? null,
  };
}

/**
 * Headline vertical slice: an attendant's pending fuel entry becomes exactly one settled
 * bill when a cashier accepts payment (docs/ER_DIAGRAM.md — pending_transactions -> bills).
 */
export function settlePendingTransaction(input: SettleInput): SettleResult {
  const pending = pendingTransactionsRepo.get(input.pendingId);
  if (!pending) throw new Error(`Pending transaction ${input.pendingId} not found`);
  if (pending.status !== "pending") {
    throw new Error(`Pending transaction ${input.pendingId} is already ${pending.status}`);
  }

  const item = itemsRepo.get(pending.item_code);
  if (!item) throw new Error(`Unknown item code: ${pending.item_code}`);

  const rate = item.price_retail;
  const qty = pending.qty ?? (pending.amount ? pending.amount / rate : 0);
  if (!qty || qty <= 0) {
    throw new Error(`Pending transaction ${input.pendingId} has no usable quantity or amount`);
  }

  const lines: NewBillLine[] = [buildLine(pending.item_code, qty)];
  for (const extra of input.extraLines ?? []) {
    lines.push(buildLine(extra.item_code, extra.qty));
  }

  const vehicle = vehiclesRepo.findOrCreate(pending.vehicle_no);

  const businessDate = businessDateRepo.get();
  applyStockForSale(lines, businessDate);

  const bill = billsRepo.create({
    vehicle_no: vehicle.vehicle_no,
    customer_code: vehicle.customer_code,
    user_id: input.cashierId,
    payment_type: input.paymentType,
    pump_code: pending.pump_code,
    bill_date: billTimestamp(businessDate),
    lines,
  });

  pendingTransactionsRepo.markSettled(pending.id, bill.bill_no);

  if (pending.odometer && item.track_mileage) {
    mileageRepo.record({
      billNo: bill.bill_no,
      vehicleNo: vehicle.vehicle_no,
      itemCode: pending.item_code,
      odometerCurr: pending.odometer,
      qty,
    });
  }

  if (vehicle.customer_code && input.paymentType === "credit") {
    customersRepo.adjustDueAmount(vehicle.customer_code, bill.grand_total);
  }

  return {
    bill,
    lines: billsRepo.getLines(bill.bill_no),
    amountInWords: amountInWords(bill.grand_total),
  };
}

/**
 * Direct cashier walk-in billing (Phase 2) — no attendant pending-transaction involved, e.g. a
 * customer buying lubricants/accessories at the counter, or a cash/credit fuel sale entered
 * straight by the cashier.
 */
export function createWalkInBill(input: WalkInBillInput): BillResult {
  if (input.lines.length === 0) {
    throw new Error("A bill needs at least one line");
  }

  for (const line of input.lines) {
    if (line.odometerOpening !== undefined && line.odometer !== undefined && line.odometer <= line.odometerOpening) {
      throw new Error(`Closing odometer must be greater than opening odometer for ${line.item_code}`);
    }
  }

  // Fulfilling a pending order: validate every tagged line up front (the order line exists,
  // belongs to the order this bill claims to fulfill, and still has room) before anything posts —
  // mirrors the credit-limit check below rather than discovering a problem after the bill exists.
  for (const line of input.lines) {
    if (line.orderLineId === undefined) continue;
    const orderLine = ordersRepo.getLine(line.orderLineId);
    if (!orderLine) throw new Error(`Order line ${line.orderLineId} not found`);
    if (input.fulfillOrderNo !== undefined && orderLine.order_no !== input.fulfillOrderNo) {
      throw new Error(`Order line ${line.orderLineId} does not belong to order ${input.fulfillOrderNo}`);
    }
    if (orderLine.qty_served + line.qty > orderLine.qty_ordered + 1e-9) {
      throw new Error(`Fulfilling ${line.qty} would exceed the ordered quantity for order line ${line.orderLineId}`);
    }
  }

  const lines = input.lines.map((l) => buildLine(l.item_code, l.qty, l.orderLineId));
  const grandTotal = lines.reduce((sum, l) => sum + l.amount, 0);

  const vehicle = input.vehicleNo ? vehiclesRepo.findOrCreate(input.vehicleNo) : undefined;
  const customerCode = input.customerCode ?? vehicle?.customer_code ?? null;

  if (input.paymentType === "credit") {
    if (!customerCode) throw new Error("Credit bills require a customer");
    const customer = customersRepo.get(customerCode);
    if (!customer) throw new Error(`Unknown customer code: ${customerCode}`);
    if (customer.credit_limit > 0 && customer.due_amount + grandTotal > customer.credit_limit) {
      throw new Error(`Credit limit exceeded for customer ${customerCode}`);
    }
  }

  const businessDate = businessDateRepo.get();
  applyStockForSale(lines, businessDate);

  const bill = billsRepo.create({
    vehicle_no: vehicle?.vehicle_no ?? null,
    customer_code: customerCode,
    user_id: input.cashierId,
    payment_type: input.paymentType,
    order_no: input.orderNo ?? null,
    pump_code: input.pumpCode ?? null,
    bill_date: billTimestamp(businessDate),
    lines,
  });

  if (vehicle) {
    for (const [i, inputLine] of input.lines.entries()) {
      if (inputLine.odometer && itemsRepo.get(inputLine.item_code)?.track_mileage) {
        mileageRepo.record({
          billNo: bill.bill_no,
          vehicleNo: vehicle.vehicle_no,
          itemCode: inputLine.item_code,
          odometerOpening: inputLine.odometerOpening,
          odometerCurr: inputLine.odometer,
          qty: lines[i].qty,
        });
      }
    }
  }

  if (customerCode && input.paymentType === "credit") {
    customersRepo.adjustDueAmount(customerCode, bill.grand_total);
  }

  for (const [i, inputLine] of input.lines.entries()) {
    if (inputLine.orderLineId !== undefined) {
      ordersRepo.applyFulfillment(inputLine.orderLineId, lines[i].qty);
    }
  }

  return {
    bill,
    lines: billsRepo.getLines(bill.bill_no),
    amountInWords: amountInWords(bill.grand_total),
  };
}

/** Legacy BILLCNCS: cancels a bill, reverses stock and any credit due-amount it posted. */
export function cancelBill(billNo: number, cancelledBy: string): Bill {
  const bill = billsRepo.get(billNo);
  if (!bill) throw new Error(`Bill ${billNo} not found`);
  if (bill.status === "cancelled") throw new Error(`Bill ${billNo} is already cancelled`);

  const lines = billsRepo.getLines(billNo);
  const saleDate = bill.bill_date.slice(0, 10);
  for (const line of lines) {
    stockRepo.reverseSale(line.item_code, line.qty, saleDate);
  }

  if (bill.customer_code && bill.payment_type === "credit") {
    customersRepo.adjustDueAmount(bill.customer_code, -bill.grand_total);
  }

  return billsRepo.cancel(billNo, cancelledBy) as Bill;
}
