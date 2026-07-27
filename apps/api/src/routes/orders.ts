import type { FastifyInstance } from "fastify";
import { ordersRepo } from "../repositories/orders.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

/** Staff-side view of a customer's orders — used by the Billing page's Pending Order section
 *  when fulfilling a Credit sale (services/billing.ts). Order placement itself is
 *  customer-only, see routes/customerOrders.ts. */
export default async function orderRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { customer_code?: string } }>(
    "/orders",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { customer_code } = request.query;
      if (!customer_code) return reply.code(400).send({ error: "customer_code is required" });
      return ordersRepo.listOpenByCustomer(customer_code);
    },
  );

  // Staff can cancel any order at any point, unlike a customer's own self-service cancel
  // (routes/customerOrders.ts), which only works while nothing has been served yet.
  fastify.post<{ Params: { orderNo: string } }>(
    "/orders/:orderNo/cancel",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      try {
        const cancelled = ordersRepo.cancel(Number(request.params.orderNo), request.user.sub);
        auditLogsRepo.record({
          user_id: request.user.sub,
          action: "cancel_order",
          entity_type: "order",
          entity_id: cancelled.order_no,
        });
        return cancelled;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
