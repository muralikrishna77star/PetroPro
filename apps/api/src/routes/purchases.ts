import type { FastifyInstance } from "fastify";
import { purchasesRepo } from "../repositories/purchases.js";
import { recordPurchase } from "../services/purchasing.js";
import type { PurchaseInput } from "../repositories/purchases.js";

export default async function purchaseRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { item_code?: string } }>(
    "/purchases",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request) => purchasesRepo.list(request.query.item_code),
  );

  fastify.post<{ Body: PurchaseInput }>(
    "/purchases",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { item_code, qty, value } = request.body ?? {};
      if (!item_code || !qty || value === undefined) {
        return reply.code(400).send({ error: "item_code, qty and value are required" });
      }
      try {
        return reply.code(201).send(recordPurchase(request.body));
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
