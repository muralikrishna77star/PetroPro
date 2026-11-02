import type { FastifyInstance } from "fastify";
import type { TechSubscriptionInput, TechSubscriptionRecord } from "@petropro/shared-types";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { techSubscriptionsRepo, validateSubscriptionInput } from "../repositories/techSubscriptions.js";
import { buildTechDashboard, integrationConfig, runProviderCheck } from "../services/techDashboard.js";
import { canRecordSubscription, catalogEntry } from "../services/techCatalog.js";

/** Fields that changed between two manual records, for the audit trail. */
function diff(before: TechSubscriptionRecord | null, after: TechSubscriptionInput | null) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    if (key === "updated_by" || key === "updated_at") continue;
    const from = (before as Record<string, unknown> | null)?.[key] ?? null;
    const to = (after as Record<string, unknown> | null)?.[key] ?? null;
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
}

/**
 * Technology & Subscription Dashboard. Every route is super_admin only. Provider tokens stay
 * in the API's environment (config.ts); responses only say whether they're set.
 */
export default async function techDashboardRoutes(fastify: FastifyInstance) {
  const superAdmin = { preHandler: fastify.requireRole("super_admin") };

  fastify.get("/tech-dashboard", superAdmin, async () => buildTechDashboard(fastify.version));

  fastify.get<{ Params: { id: string } }>("/tech-dashboard/services/:id/history", superAdmin, async (request, reply) => {
    const entry = catalogEntry(request.params.id);
    if (!entry) return reply.code(404).send({ error: "Unknown service" });
    return auditLogsRepo.list({ entityType: "tech_subscription", entityId: entry.id }, 50);
  });

  fastify.put<{ Params: { id: string }; Body: Partial<TechSubscriptionInput> }>(
    "/tech-dashboard/services/:id/subscription",
    superAdmin,
    async (request, reply) => {
      const entry = catalogEntry(request.params.id);
      if (!entry) return reply.code(404).send({ error: "Unknown service" });
      if (!canRecordSubscription(entry)) {
        return reply.code(400).send({
          error: entry.billed_with
            ? `${entry.name} is billed with ${catalogEntry(entry.billed_with)?.name ?? entry.billed_with}. Record it there.`
            : `${entry.name} has no subscription of its own (${entry.cost_model.replace("_", " ")})`,
        });
      }
      let input: TechSubscriptionInput;
      try {
        input = validateSubscriptionInput(request.body ?? {});
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
      const before = techSubscriptionsRepo.get(entry.id);
      const saved = techSubscriptionsRepo.upsert(entry.id, input, request.user.sub);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: before ? "update_tech_subscription" : "create_tech_subscription",
        entity_type: "tech_subscription",
        entity_id: entry.id,
        details: { changes: diff(before, input) },
      });
      return saved;
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/tech-dashboard/services/:id/subscription",
    superAdmin,
    async (request, reply) => {
      const entry = catalogEntry(request.params.id);
      if (!entry) return reply.code(404).send({ error: "Unknown service" });
      const before = techSubscriptionsRepo.get(entry.id);
      if (!before) return reply.code(404).send({ error: "No subscription record to clear" });
      techSubscriptionsRepo.remove(entry.id);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "clear_tech_subscription",
        entity_type: "tech_subscription",
        entity_id: entry.id,
        details: { changes: diff(before, null) },
      });
      return { ok: true };
    },
  );

  // Read-only call to the provider. Never changes a subscription, and never writes the manual
  // record: the result is stored separately as "verified".
  fastify.post<{ Params: { id: string } }>(
    "/tech-dashboard/services/:id/verify",
    superAdmin,
    async (request, reply) => {
      const entry = catalogEntry(request.params.id);
      if (!entry) return reply.code(404).send({ error: "Unknown service" });
      if (!entry.integration) {
        return reply.code(400).send({ error: `${entry.name} has no supported provider API. Maintain it manually.` });
      }
      const { configured, missing } = integrationConfig(entry.integration.provider);
      if (!configured) {
        return reply.code(400).send({ error: `Not configured: set ${missing.join(", ")} on the API server` });
      }
      const result = await runProviderCheck(entry.integration.provider);
      const stored = techSubscriptionsRepo.recordCheck(entry.id, result);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "verify_tech_subscription",
        entity_type: "tech_subscription",
        entity_id: entry.id,
        details: { integration: result.integration, ok: result.ok, plan: result.plan, error: result.error },
      });
      return stored;
    },
  );
}
