import type { FastifyInstance } from "fastify";
import { shiftsRepo } from "../repositories/shifts.js";
import { openShift, closeShift } from "../services/shifts.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function shiftRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/shifts",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async () => shiftsRepo.list(),
  );

  fastify.get(
    "/shifts/current",
    { preHandler: fastify.authenticate },
    async (request) => shiftsRepo.getOpenForUser(request.user.sub) ?? null,
  );

  fastify.post<{ Body: { opening_cash: number } }>(
    "/shifts/open",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator", "field_operator") },
    async (request, reply) => {
      const { opening_cash } = request.body ?? {};
      if (opening_cash === undefined) {
        return reply.code(400).send({ error: "opening_cash is required" });
      }
      try {
        const shift = openShift(request.user.sub, opening_cash);
        auditLogsRepo.record({
          user_id: request.user.sub,
          action: "open_shift",
          entity_type: "shift",
          entity_id: shift.id,
          details: { opening_cash },
        });
        return reply.code(201).send(shift);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  fastify.post<{ Params: { id: string }; Body: { closing_cash: number; notes?: string } }>(
    "/shifts/:id/close",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator", "field_operator") },
    async (request, reply) => {
      const { closing_cash, notes } = request.body ?? {};
      if (closing_cash === undefined) {
        return reply.code(400).send({ error: "closing_cash is required" });
      }
      try {
        const shift = closeShift(Number(request.params.id), closing_cash, notes);
        auditLogsRepo.record({
          user_id: request.user.sub,
          action: "close_shift",
          entity_type: "shift",
          entity_id: shift.id,
          details: { closing_cash, expected_cash: shift.expected_cash, variance: shift.variance },
        });
        return shift;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
