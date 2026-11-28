import { db } from "../db/client.js";

export type OrderStatus = "open" | "partially_served" | "completed" | "cancelled";

export interface Order {
  order_no: number;
  customer_code: string;
  status: OrderStatus;
  /** 1 when the customer allowed the station to bill other items alongside this order's lines. */
  allow_extra_items: number;
  vehicle_no: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

export interface OrderLine {
  id: number;
  order_no: number;
  item_code: string;
  qty_ordered: number;
  qty_served: number;
  rate_at_order: number;
}

export interface OrderWithLines extends Order {
  lines: OrderLine[];
}

export interface NewOrderLine {
  item_code: string;
  qty_ordered: number;
  rate_at_order: number;
}

const EPSILON = 1e-9;

/** Moves an order line's qty_served by `delta` and recomputes the parent order's status in one
 *  transaction. A cancelled order keeps its status. */
function adjustServed(line: OrderLine, delta: number): void {
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE order_lines SET qty_served = qty_served + ? WHERE id = ?").run(delta, line.id);
    const lines = ordersRepo.getLines(line.order_no);
    const allServed = lines.every((l) => l.qty_served >= l.qty_ordered - EPSILON);
    const noneServed = lines.every((l) => l.qty_served <= EPSILON);
    const status: OrderStatus = allServed ? "completed" : noneServed ? "open" : "partially_served";
    db.prepare("UPDATE orders SET status = ? WHERE order_no = ? AND status <> 'cancelled'").run(status, line.order_no);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export const ordersRepo = {
  get(orderNo: number): Order | undefined {
    return db.prepare("SELECT * FROM orders WHERE order_no = ?").get(orderNo) as Order | undefined;
  },

  getLines(orderNo: number): OrderLine[] {
    return db
      .prepare("SELECT * FROM order_lines WHERE order_no = ? ORDER BY id")
      .all(orderNo) as unknown as OrderLine[];
  },

  getLine(orderLineId: number): OrderLine | undefined {
    return db.prepare("SELECT * FROM order_lines WHERE id = ?").get(orderLineId) as OrderLine | undefined;
  },

  getWithLines(orderNo: number): OrderWithLines | undefined {
    const order = ordersRepo.get(orderNo);
    if (!order) return undefined;
    return { ...order, lines: ordersRepo.getLines(orderNo) };
  },

  listByCustomer(customerCode: string): OrderWithLines[] {
    const orders = db
      .prepare("SELECT * FROM orders WHERE customer_code = ? ORDER BY order_no DESC")
      .all(customerCode) as unknown as Order[];
    return orders.map((o) => ({ ...o, lines: ordersRepo.getLines(o.order_no) }));
  },

  /** Orders a biller can still fulfill against — used by the Billing page's Pending Order
   *  section (see services/billing.ts). */
  listOpenByCustomer(customerCode: string): OrderWithLines[] {
    const orders = db
      .prepare(
        "SELECT * FROM orders WHERE customer_code = ? AND status IN ('open', 'partially_served') ORDER BY order_no",
      )
      .all(customerCode) as unknown as Order[];
    return orders.map((o) => ({ ...o, lines: ordersRepo.getLines(o.order_no) }));
  },

  /** Creates an order + its lines as a single unit. Not wrapped in an app-level transaction
   *  helper because node:sqlite's DatabaseSync has no transaction() API — BEGIN/COMMIT are
   *  issued directly so a failed line insert rolls back the whole order (mirrors bills.ts). */
  create(input: {
    customerCode: string;
    lines: NewOrderLine[];
    allowExtraItems?: boolean;
    vehicleNo?: string | null;
  }): OrderWithLines {
    if (input.lines.length === 0) throw new Error("An order needs at least one line");

    db.exec("BEGIN");
    try {
      const orderResult = db
        .prepare("INSERT INTO orders (customer_code, allow_extra_items, vehicle_no) VALUES (?, ?, ?)")
        .run(input.customerCode, input.allowExtraItems ? 1 : 0, input.vehicleNo || null);
      const orderNo = Number(orderResult.lastInsertRowid);

      for (const line of input.lines) {
        db.prepare(
          "INSERT INTO order_lines (order_no, item_code, qty_ordered, rate_at_order) VALUES (?, ?, ?, ?)",
        ).run(orderNo, line.item_code, line.qty_ordered, line.rate_at_order);
      }
      db.exec("COMMIT");
      return ordersRepo.getWithLines(orderNo) as OrderWithLines;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  },

  /** Draws `qty` off a single order line (one bill line's worth of fulfillment against it),
   *  then recomputes and persists the parent order's status. Throws rather than overfilling
   *  the line, mirroring how createWalkInBill throws on an exceeded credit limit. */
  applyFulfillment(orderLineId: number, qty: number): void {
    const line = ordersRepo.getLine(orderLineId);
    if (!line) throw new Error(`Order line ${orderLineId} not found`);
    if (line.qty_served + qty > line.qty_ordered + EPSILON) {
      throw new Error(`Fulfilling ${qty} would exceed the ordered quantity for order line ${orderLineId}`);
    }
    adjustServed(line, qty);
  },

  /** Gives `qty` back to an order line when the bill that served it is cancelled, so the
   *  order shows it as pending again. A cancelled order stays cancelled. */
  reverseFulfillment(orderLineId: number, qty: number): void {
    const line = ordersRepo.getLine(orderLineId);
    if (!line) return;
    adjustServed(line, -Math.min(qty, line.qty_served));
  },

  cancel(orderNo: number, cancelledBy: string): Order {
    const order = ordersRepo.get(orderNo);
    if (!order) throw new Error(`Order ${orderNo} not found`);
    if (order.status === "cancelled") throw new Error(`Order ${orderNo} is already cancelled`);
    db.prepare(
      "UPDATE orders SET status = 'cancelled', cancelled_at = datetime('now'), cancelled_by = ? WHERE order_no = ?",
    ).run(cancelledBy, orderNo);
    return ordersRepo.get(orderNo) as Order;
  },
};
