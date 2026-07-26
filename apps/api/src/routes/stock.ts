import type { FastifyInstance } from "fastify";
import { stockRepo, todayDateOnly } from "../repositories/stock.js";
import { businessDateRepo } from "../repositories/businessDate.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function stockRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { date?: string } }>(
    "/stock",
    { preHandler: fastify.authenticate },
    async (request) => stockRepo.listByDate(request.query.date ?? todayDateOnly()),
  );

  fastify.get("/business-date", { preHandler: fastify.authenticate }, async () => ({
    date: businessDateRepo.get(),
  }));

  // Always closes the current running business date (not an arbitrary date) and advances it by
  // one day — capped at today, so the running date never gets ahead of the real calendar date.
  fastify.post(
    "/stock/close",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async (request, reply) => {
      const closedDate = businessDateRepo.get();
      const rowsClosed = stockRepo.closeDay(closedDate);
      const runningDate = businessDateRepo.advance();
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "close_day",
        entity_type: "business_date",
        details: { closedDate, rowsClosed, newRunningDate: runningDate },
      });
      return reply.send({ closedDate, rowsClosed, runningDate });
    },
  );
}
