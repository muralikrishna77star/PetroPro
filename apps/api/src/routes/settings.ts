import type { FastifyInstance } from "fastify";
import { settingsRepo, SETTINGS_KEYS, type Settings } from "../repositories/settings.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/settings",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async () => settingsRepo.getAll(),
  );

  fastify.put<{ Body: Partial<Settings> }>(
    "/settings",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      const body = request.body ?? {};
      for (const [key, value] of Object.entries(body)) {
        if (!SETTINGS_KEYS.includes(key as (typeof SETTINGS_KEYS)[number])) {
          return reply.code(400).send({ error: `Unknown setting: ${key}` });
        }
        if (value !== "YES" && value !== "NO") {
          return reply.code(400).send({ error: `${key} must be YES or NO` });
        }
      }
      const updated = settingsRepo.setMany(body);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "update_settings",
        entity_type: "settings",
        details: body,
      });
      return updated;
    },
  );
}
