import type { FastifyInstance } from "fastify";
import { itemsRepo, type ItemInput } from "../repositories/items.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function itemRoutes(fastify: FastifyInstance) {
  fastify.get("/items", { preHandler: fastify.authenticate }, async () => itemsRepo.list());

  fastify.get<{ Params: { code: string } }>(
    "/items/:code",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const item = itemsRepo.get(request.params.code);
      if (!item) return reply.code(404).send({ error: "Item not found" });
      return item;
    },
  );

  fastify.post<{ Body: ItemInput }>(
    "/items",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => reply.code(201).send(itemsRepo.create(request.body)),
  );

  fastify.put<{ Params: { code: string }; Body: Omit<ItemInput, "code"> }>(
    "/items/:code",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const updated = itemsRepo.update(request.params.code, request.body);
      if (!updated) return reply.code(404).send({ error: "Item not found" });
      return updated;
    },
  );

  // Bulk tax-rate revision (e.g. a GST rate change decree affecting a whole product group).
  fastify.post<{ Body: { tax_percent: number; group_code?: string } }>(
    "/items/bulk-tax-change",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { tax_percent, group_code } = request.body ?? {};
      if (tax_percent === undefined) {
        return reply.code(400).send({ error: "tax_percent is required" });
      }
      const updated = itemsRepo.bulkUpdateTaxPercent(tax_percent, group_code);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "bulk_tax_change",
        entity_type: "items",
        details: { tax_percent, group_code, affected: updated.length },
      });
      return updated;
    },
  );
}
