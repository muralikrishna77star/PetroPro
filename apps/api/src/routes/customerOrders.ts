import type { FastifyInstance } from "fastify";
import { ordersRepo } from "../repositories/orders.js";
import { itemsRepo } from "../repositories/items.js";
import { vehiclesRepo } from "../repositories/vehicles.js";

/** Customer-facing order placement/history — the customer's own Order Entry screen. Staff-side
 *  lookup of a customer's pending orders (for billing/fulfillment) lives in routes/orders.ts. */
export default async function customerOrderRoutes(fastify: FastifyInstance) {
  // The items a customer can put on a purchase order. The staff GET /items refuses customer
  // tokens, and would hand out cost prices besides — this returns only what the order screen
  // shows: code, name and today's selling rate.
  fastify.get("/customer/items", { preHandler: fastify.authenticateCustomer }, async () =>
    itemsRepo.list().map((item) => ({ code: item.code, name: item.name, price_retail: item.price_retail })),
  );

  // The customer's own vehicles, for the Purchase Order screen's vehicle box.
  fastify.get("/customer/vehicles", { preHandler: fastify.authenticateCustomer }, async (request) =>
    vehiclesRepo.listByCustomer(request.user.sub).map((v) => ({ vehicle_no: v.vehicle_no })),
  );

  fastify.get(
    "/customer/orders",
    { preHandler: fastify.authenticateCustomer },
    async (request) => ordersRepo.listByCustomer(request.user.sub),
  );

  fastify.post<{
    Body: { lines: { item_code: string; qty: number }[]; allow_extra_items?: boolean; vehicle_no?: string };
  }>(
    "/customer/orders",
    { preHandler: fastify.authenticateCustomer },
    async (request, reply) => {
      const { lines, allow_extra_items, vehicle_no } = request.body ?? {};
      if (!lines?.length) {
        return reply.code(400).send({ error: "An order needs at least one line" });
      }
      for (const line of lines) {
        if (!line.item_code || typeof line.qty !== "number" || !(line.qty > 0)) {
          return reply.code(400).send({ error: "Each line needs an item_code and a positive qty" });
        }
      }
      if (!vehicle_no?.trim()) {
        return reply.code(400).send({ error: "Enter the vehicle number this order is for" });
      }
      // A vehicle already on another customer's account can't be ordered for here; a new number
      // joins the vehicle master under this customer.
      const onFile = vehiclesRepo.resolve(vehicle_no);
      if (onFile?.customer_code && onFile.customer_code !== request.user.sub) {
        return reply
          .code(400)
          .send({ error: `${onFile.vehicle_no} is registered to another account. Please contact the station.` });
      }

      try {
        for (const line of lines) {
          if (!itemsRepo.get(line.item_code)) throw new Error(`Unknown item code: ${line.item_code}`);
        }
        const vehicle = vehiclesRepo.findOrCreate(vehicle_no, request.user.sub);
        const orderLines = lines.map((line) => {
          const item = itemsRepo.get(line.item_code);
          if (!item) throw new Error(`Unknown item code: ${line.item_code}`);
          return { item_code: line.item_code, qty_ordered: line.qty, rate_at_order: item.price_retail };
        });
        const order = ordersRepo.create({
          customerCode: request.user.sub,
          lines: orderLines,
          allowExtraItems: allow_extra_items === true,
          vehicleNo: vehicle.vehicle_no,
        });
        return reply.code(201).send(order);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // A customer may withdraw their own order only while nothing on it has been served yet —
  // once staff have billed part of it, cancelling has to go through the station (routes/orders.ts).
  fastify.post<{ Params: { orderNo: string } }>(
    "/customer/orders/:orderNo/cancel",
    { preHandler: fastify.authenticateCustomer },
    async (request, reply) => {
      const orderNo = Number(request.params.orderNo);
      const order = ordersRepo.get(orderNo);
      if (!order || order.customer_code !== request.user.sub) {
        return reply.code(404).send({ error: "Order not found" });
      }
      const lines = ordersRepo.getLines(orderNo);
      if (lines.some((line) => line.qty_served > 0)) {
        return reply
          .code(400)
          .send({ error: "This order has already been partly served — contact the station to cancel it." });
      }

      try {
        return ordersRepo.cancel(orderNo, "customer");
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
