import type { FastifyInstance } from "fastify";
import { rateChangesRepo, type RateChangeInput } from "../repositories/rateChanges.js";
import { applyDueRateChanges } from "../services/rateChanges.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function rateChangeRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { pending?: string } }>(
    "/rate-changes",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request) => rateChangesRepo.list(request.query.pending === "true"),
  );

  fastify.post<{ Body: RateChangeInput }>(
    "/rate-changes",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { item_code, rate, scheduled_on } = request.body ?? {};
      if (!item_code || !rate || !scheduled_on) {
        return reply.code(400).send({ error: "item_code, rate and scheduled_on are required" });
      }
      const created = rateChangesRepo.create(request.body);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "schedule_rate_change",
        entity_type: "rate_change",
        entity_id: created.id,
        details: { item_code, rate, scheduled_on },
      });
      return reply.code(201).send(created);
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/rate-changes/:id",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const id = Number(request.params.id);
      const existing = rateChangesRepo.get(id);
      if (!existing) return reply.code(404).send({ error: "Rate change not found" });
      if (existing.applied) {
        return reply.code(400).send({ error: "Cannot retract a rate change that has already been applied" });
      }
      rateChangesRepo.remove(id);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "retract_rate_change",
        entity_type: "rate_change",
        entity_id: id,
        details: { item_code: existing.item_code, rate: existing.rate, scheduled_on: existing.scheduled_on },
      });
      return reply.code(204).send();
    },
  );

  // Applies every scheduled change whose effective date has arrived. Manually triggered for
  // now (e.g. once at day-open) — no background scheduler exists yet.
  fastify.post<{ Body: { date?: string } }>(
    "/rate-changes/apply-due",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request) => {
      const applied = applyDueRateChanges(request.body?.date);
      if (applied.length > 0) {
        auditLogsRepo.record({
          user_id: request.user.sub,
          action: "apply_rate_changes",
          entity_type: "rate_change",
          details: { count: applied.length, ids: applied.map((c) => c.id) },
        });
      }
      return applied;
    },
  );
}
