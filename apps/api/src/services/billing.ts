import { itemsRepo } from "../repositories/items.js";
import { vehiclesRepo } from "../repositories/vehicles.js";
import { pendingTransactionsRepo } from "../repositories/pendingTransactions.js";
import { billsRepo, type Bill, type BillLine, type NewBillLine } from "../repositories/bills.js";
import { customersRepo } from "../repositories/customers.js";
import { stockRepo } from "../repositories/stock.js";
import { config } from "../config.js";
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
  /** Idempotency key for offline-queued bill submissions — see createWalkInBill's early-return
   *  below and web's lib/offlineQueue.ts. */
  clientRef?: string | null;
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

/** The station's own clock, for the printed receipt. bill_date's time stays in UTC because shifts
 *  compare it with UTC timestamps to work out each shift's cash. */
function stationTime(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: config.stationTimeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
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
    local_time: stationTime(),
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
 * Billing against a customer's purchase order: checks every order-tagged line up front, before
 * anything posts (the same way the credit-limit check runs before the bill exists). The bill can
 * draw on one order only, which must be the bill's customer's and still open. Each tagged line
 * must be that order's line for the same item, and the bill can't serve more than is still
 * pending. Lines not on the order are allowed only when the customer allowed extra items on it.
 */
function validateOrderFulfillment(input: WalkInBillInput, customerCode: string | null): void {
  const tagged = input.lines.filter((l) => l.orderLineId !== undefined);
  if (input.fulfillOrderNo === undefined && tagged.length === 0) return;

  // Older clients (and offline-queued bills) send only the line tags, so the order is worked out
  // from the first tagged line when the bill doesn't name one.
  let orderNo = input.fulfillOrderNo;
  if (orderNo === undefined) {
    const first = ordersRepo.getLine(tagged[0].orderLineId as number);
    if (!first) throw new Error(`Order line ${tagged[0].orderLineId} not found`);
    orderNo = first.order_no;
  }

  const order = ordersRepo.get(orderNo);
  if (!order) throw new Error(`Order ${orderNo} not found`);
  if (order.status !== "open" && order.status !== "partially_served") {
    throw new Error(`Order ${orderNo} is ${order.status.replace("_", " ")} and can't be billed`);
  }
  if (input.paymentType !== "credit") {
    throw new Error("Bills against a purchase order must be Credit sales");
  }
  if (!customerCode || order.customer_code.toUpperCase() !== customerCode.toUpperCase()) {
    throw new Error(`Order ${orderNo} belongs to a different customer`);
  }

  const servedNow = new Map<number, number>();
  for (const line of input.lines) {
    if (line.orderLineId === undefined) {
      if (!order.allow_extra_items) {
        throw new Error(`Order ${orderNo} doesn't allow additional items — ${line.item_code} isn't on the order`);
      }
      continue;
    }
    const orderLine = ordersRepo.getLine(line.orderLineId);
    if (!orderLine) throw new Error(`Order line ${line.orderLineId} not found`);
    if (orderLine.order_no !== orderNo) {
      throw new Error(`Order line ${line.orderLineId} does not belong to order ${orderNo}`);
    }
    if (orderLine.item_code !== line.item_code) {
      throw new Error(`Order line ${line.orderLineId} is for ${orderLine.item_code}, not ${line.item_code}`);
    }
    // Two bill lines can draw on the same order line, so the room left is checked on their sum.
    const total = (servedNow.get(orderLine.id) ?? 0) + line.qty;
    servedNow.set(orderLine.id, total);
    if (orderLine.qty_served + total > orderLine.qty_ordered + 1e-9) {
      throw new Error(`Fulfilling ${total} would exceed the ordered quantity for order line ${line.orderLineId}`);
    }
  }
}

/**
 * Direct cashier walk-in billing (Phase 2) — no attendant pending-transaction involved, e.g. a
 * customer buying lubricants/accessories at the counter, or a cash/credit fuel sale entered
 * straight by the cashier.
 */
export function createWalkInBill(input: WalkInBillInput): BillResult {
  // Idempotent retry: an offline-queued bill synced twice (e.g. the sync succeeded but the
  // client never saw the response) must resolve to the one bill already created, not a duplicate.
  if (input.clientRef) {
    const existing = billsRepo.getByClientRef(input.clientRef);
    if (existing) {
      return {
        bill: existing,
        lines: billsRepo.getLines(existing.bill_no),
        amountInWords: amountInWords(existing.grand_total),
      };
    }
  }

  if (input.lines.length === 0) {
    throw new Error("A bill needs at least one line");
  }

  for (const line of input.lines) {
    if (line.odometerOpening !== undefined && line.odometer !== undefined && line.odometer <= line.odometerOpening) {
      throw new Error(`Closing odometer must be greater than opening odometer for ${line.item_code}`);
    }
  }

  const vehicle = input.vehicleNo ? vehiclesRepo.findOrCreate(input.vehicleNo) : undefined;
  const customerCode = input.customerCode ?? vehicle?.customer_code ?? null;

  validateOrderFulfillment(input, customerCode);

  const lines = input.lines.map((l) => buildLine(l.item_code, l.qty, l.orderLineId));
  const grandTotal = lines.reduce((sum, l) => sum + l.amount, 0);

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
    local_time: stationTime(),
    client_ref: input.clientRef ?? null,
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

  // Whatever this bill served off a purchase order is pending on that order again.
  for (const line of lines) {
    if (line.order_line_id != null) ordersRepo.reverseFulfillment(line.order_line_id, line.qty);
  }

  return billsRepo.cancel(billNo, cancelledBy) as Bill;
}
