import type { FastifyInstance } from "fastify";
import { stockRepo, todayDateOnly } from "../repositories/stock.js";
import { businessDateRepo } from "../repositories/businessDate.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { closeBusinessDay, closeDaySummary } from "../services/closeDay.js";
import { closeDaySettingsRepo, type CloseDaySettings } from "../repositories/closeDaySettings.js";

export default async function stockRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { date?: string } }>(
    "/stock",
    { preHandler: fastify.authenticate },
    async (request) => stockRepo.listByDate(request.query.date ?? todayDateOnly()),
  );

  fastify.get("/business-date", { preHandler: fastify.authenticate }, async () => ({
    date: businessDateRepo.get(),
  }));

  // What Close Day asks the cashier to confirm: the running date's sales by item, their own
  // sales, the day billing moves on to, and whether the date can be closed yet.
  fastify.get(
    "/stock/close/summary",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async (request) => closeDaySummary(businessDateRepo.get(), request.user.sub),
  );

  // Always closes the current running business date (not an arbitrary date), refusing until the
  // Close Day settings allow it, then moves billing on — see services/closeDay.ts.
  fastify.post(
    "/stock/close",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async (request, reply) => {
      let result;
      try {
        result = closeBusinessDay(request.user.sub);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
      const { closedDate, rowsClosed, runningDate } = result;
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "close_day",
        entity_type: "business_date",
        details: { closedDate, rowsClosed, newRunningDate: runningDate },
      });
      return reply.send(result);
    },
  );

  // Close Day's settings: the earliest time a date can be closed on the day itself, and whether
  // billing moves straight on to tomorrow or waits for the date to change.
  fastify.get(
    "/close-day/settings",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async () => closeDaySettingsRepo.get(),
  );

  fastify.put<{ Body: Partial<CloseDaySettings> }>(
    "/close-day/settings",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const body = request.body ?? {};
      try {
        const updated = closeDaySettingsRepo.set({
          ...(body.min_close_time !== undefined ? { min_close_time: body.min_close_time } : {}),
          ...(body.next_date !== undefined ? { next_date: body.next_date } : {}),
          ...(body.day_changeover_time !== undefined ? { day_changeover_time: body.day_changeover_time } : {}),
        });
        auditLogsRepo.record({
          user_id: request.user.sub,
          action: "update_close_day_settings",
          entity_type: "settings",
          details: updated,
        });
        return updated;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
