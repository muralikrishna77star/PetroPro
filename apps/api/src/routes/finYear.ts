import type { FastifyInstance } from "fastify";
import { finYearsRepo } from "../repositories/finYears.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function finYearRoutes(fastify: FastifyInstance) {
  fastify.get("/fin-year", { preHandler: fastify.authenticate }, async () => finYearsRepo.get());

  fastify.put<{ Body: { fin_year_start: string } }>(
    "/fin-year",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { fin_year_start } = request.body ?? {};
      if (!fin_year_start) return reply.code(400).send({ error: "fin_year_start is required" });
      const updated = finYearsRepo.set(fin_year_start);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "switch_financial_year",
        entity_type: "fin_year",
        details: { fin_year_start },
      });
      return updated;
    },
  );
}
