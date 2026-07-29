import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { createBackup, getBackupPath, listBackups, restoreBackup } from "../services/backup.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function backupRoutes(fastify: FastifyInstance) {
  fastify.get("/backup", { preHandler: fastify.requireRole("super_admin") }, async () => listBackups());

  // Gets a copy of a backup off the server — the only way to survive losing the server disk
  // itself, since createBackup()/restoreBackup() otherwise never leave the backups/ folder.
  fastify.get<{ Params: { filename: string } }>(
    "/backup/:filename/download",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      try {
        const filePath = getBackupPath(request.params.filename);
        return reply
          .header("Content-Type", "application/octet-stream")
          .header("Content-Disposition", `attachment; filename="${request.params.filename}"`)
          .send(fs.createReadStream(filePath));
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  fastify.post(
    "/backup",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      const backup = createBackup();
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "create_backup",
        entity_type: "database",
        entity_id: backup.filename,
      });
      return reply.code(201).send(backup);
    },
  );

  // Destructive and irreversible for anything written since the backup — requires an explicit
  // confirm flag rather than relying on the UI alone to gate this.
  fastify.post<{ Body: { filename: string; confirm: boolean } }>(
    "/backup/restore",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      const { filename, confirm } = request.body ?? {};
      if (!filename || !confirm) {
        return reply.code(400).send({ error: "filename and confirm: true are required" });
      }
      try {
        restoreBackup(filename);
        auditLogsRepo.record({
          user_id: request.user.sub,
          action: "restore_backup",
          entity_type: "database",
          entity_id: filename,
        });
        return { restored: filename };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
