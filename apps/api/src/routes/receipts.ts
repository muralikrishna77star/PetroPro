import type { FastifyInstance } from "fastify";
import { receiptsRepo } from "../repositories/receipts.js";
import { recordReceipt } from "../services/customerAccounts.js";
import { generateReceiptPdf } from "../services/receiptPdf.js";
import type { ReceiptInput } from "../repositories/receipts.js";

export default async function receiptRoutes(fastify: FastifyInstance) {
  // Print-ready receipt (also serves duplicate/reprint requests — same receipt, regenerated on demand).
  fastify.get<{ Params: { recNo: string } }>(
    "/receipts/:recNo/pdf",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const buffer = await generateReceiptPdf(Number(request.params.recNo));
        return reply
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", `inline; filename="receipt-${request.params.recNo}.pdf"`)
          .send(buffer);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  fastify.get<{ Querystring: { customer_code: string } }>(
    "/receipts",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async (request, reply) => {
      if (!request.query.customer_code) {
        return reply.code(400).send({ error: "customer_code query param is required" });
      }
      return receiptsRepo.listByCustomer(request.query.customer_code);
    },
  );

  fastify.post<{ Body: Omit<ReceiptInput, "cashier_id"> }>(
    "/receipts",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async (request, reply) => {
      const { customer_code, amount, mode } = request.body ?? {};
      if (!customer_code || !amount || !mode) {
        return reply.code(400).send({ error: "customer_code, amount and mode are required" });
      }
      try {
        const receipt = recordReceipt({ ...request.body, cashier_id: request.user.sub });
        return reply.code(201).send(receipt);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
