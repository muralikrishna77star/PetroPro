import type { FastifyInstance } from "fastify";
import { customersRepo, type CustomerInput } from "../repositories/customers.js";
import { setOpeningBalance } from "../services/customerAccounts.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function customerRoutes(fastify: FastifyInstance) {
  fastify.get("/customers", { preHandler: fastify.authenticate }, async () => customersRepo.list());

  fastify.get<{ Params: { code: string } }>(
    "/customers/:code",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const customer = customersRepo.get(request.params.code);
      if (!customer) return reply.code(404).send({ error: "Customer not found" });
      return customer;
    },
  );

  fastify.post<{ Body: CustomerInput }>(
    "/customers",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => reply.code(201).send(customersRepo.create(request.body)),
  );

  fastify.put<{ Params: { code: string }; Body: Omit<CustomerInput, "code"> }>(
    "/customers/:code",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const updated = customersRepo.update(request.params.code, request.body);
      if (!updated) return reply.code(404).send({ error: "Customer not found" });
      return updated;
    },
  );

  // Legacy OP_BAL: one-time starting due-amount for a customer (onboarding/migration).
  fastify.post<{ Params: { code: string }; Body: { op_date: string; op_balance: number } }>(
    "/customers/:code/opening-balance",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { op_date, op_balance } = request.body ?? {};
      if (!op_date || op_balance === undefined) {
        return reply.code(400).send({ error: "op_date and op_balance are required" });
      }
      try {
        const balance = setOpeningBalance({ customer_code: request.params.code, op_date, op_balance });
        auditLogsRepo.record({
          user_id: request.user.sub,
          action: "set_opening_balance",
          entity_type: "customer",
          entity_id: request.params.code,
          details: { op_date, op_balance },
        });
        return reply.code(201).send(balance);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
