import type { FastifyInstance } from "fastify";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function auditLogRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { user_id?: string; entity_type?: string } }>(
    "/audit-logs",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request) =>
      auditLogsRepo.list({ userId: request.query.user_id, entityType: request.query.entity_type }),
  );
}
