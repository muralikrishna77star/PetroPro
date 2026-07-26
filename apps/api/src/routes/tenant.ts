import type { FastifyInstance } from "fastify";
import { tenantsRepo, type Tenant } from "../repositories/tenants.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function tenantRoutes(fastify: FastifyInstance) {
  fastify.get("/tenant", { preHandler: fastify.authenticate }, async () => tenantsRepo.get());

  fastify.put<{ Body: Tenant }>(
    "/tenant",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { name } = request.body ?? {};
      if (!name) return reply.code(400).send({ error: "name is required" });
      const updated = tenantsRepo.update(request.body);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "update_tenant",
        entity_type: "tenant",
        // Don't dump the QR code's base64 data URL into the audit log on every save.
        details: { ...request.body, payment_qr_code: request.body.payment_qr_code ? "[set]" : null },
      });
      return updated;
    },
  );
}
