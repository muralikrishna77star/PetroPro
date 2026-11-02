import type { FastifyInstance } from "fastify";
import { auditLogsRepo } from "../repositories/auditLogs.js";

/** Entries from super_admin-only screens. Owners can read the audit log, but these record what
 *  those screens hold (e.g. subscription costs), so they stay super_admin only too. */
const SUPER_ADMIN_ONLY_ENTITIES = ["tech_subscription"];

export default async function auditLogRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { user_id?: string; entity_type?: string } }>(
    "/audit-logs",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request) =>
      auditLogsRepo.list({
        userId: request.query.user_id,
        entityType: request.query.entity_type,
        excludeEntityTypes: request.user.role === "super_admin" ? undefined : SUPER_ADMIN_ONLY_ENTITIES,
      }),
  );
}
