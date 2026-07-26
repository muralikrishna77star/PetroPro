import type { FastifyInstance } from "fastify";
import { resetTransactionalData } from "../services/dataReset.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function dataResetRoutes(fastify: FastifyInstance) {
  // Highly destructive (wipes all transactional history) — requires an explicit confirm flag
  // rather than relying on the UI alone to gate this, same convention as /backup/restore.
  fastify.post<{ Body: { confirm: boolean } }>(
    "/data-reset",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      if (!request.body?.confirm) {
        return reply.code(400).send({ error: "confirm: true is required" });
      }
      const summary = resetTransactionalData();
      // Recorded after the reset, so it's the first entry in the fresh audit trail.
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "reset_transactional_data",
        entity_type: "database",
        details: { backupFile: summary.backup.filename, finYearStart: summary.finYearStart },
      });
      return summary;
    },
  );
}
