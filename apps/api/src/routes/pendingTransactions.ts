import type { FastifyInstance } from "fastify";
import { pendingTransactionsRepo, type PendingTransactionInput } from "../repositories/pendingTransactions.js";

export default async function pendingTransactionRoutes(fastify: FastifyInstance) {
  // Cashier's Pending Queue.
  fastify.get(
    "/pending-transactions",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async () => pendingTransactionsRepo.listPending(),
  );

  // Attendant entry: vehicle no, fuel item, qty/amount, optional odometer. `client_ref` (a
  // client-generated UUID) makes retries safe — the offline queue on the attendant PWA may
  // submit the same entry twice if a sync attempt's response is lost after it actually landed.
  fastify.post<{ Body: Omit<PendingTransactionInput, "attendant_id"> }>(
    "/pending-transactions",
    { preHandler: fastify.requireRole("super_admin", "owner", "field_operator") },
    async (request, reply) => {
      const { vehicle_no, item_code, qty, amount, odometer, client_ref, pump_code } = request.body ?? {};
      if (!vehicle_no || !item_code || (!qty && !amount)) {
        return reply.code(400).send({ error: "vehicle_no, item_code and qty or amount are required" });
      }

      if (client_ref) {
        const existing = pendingTransactionsRepo.getByClientRef(client_ref);
        if (existing) return reply.code(200).send(existing);
      }

      const created = pendingTransactionsRepo.create({
        vehicle_no,
        item_code,
        qty,
        amount,
        odometer,
        client_ref,
        pump_code,
        attendant_id: request.user.sub,
      });
      return reply.code(201).send(created);
    },
  );
}
