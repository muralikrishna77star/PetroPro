import type { FastifyInstance } from "fastify";
import { billsRepo } from "../repositories/bills.js";
import {
  settlePendingTransaction,
  createWalkInBill,
  cancelBill,
  type ExtraLineInput,
  type WalkInLineInput,
} from "../services/billing.js";
import { amountInWords } from "../services/money.js";
import { generateInvoicePdf } from "../services/invoicePdf.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

export default async function billRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { vehicle_no?: string; customer_code?: string } }>(
    "/bills/last",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { vehicle_no, customer_code } = request.query;
      const bill = billsRepo.getLast({ vehicleNo: vehicle_no, customerCode: customer_code });
      if (!bill) return reply.code(404).send({ error: "No bills found" });
      return {
        bill,
        lines: billsRepo.getLines(bill.bill_no),
        amountInWords: amountInWords(bill.grand_total),
      };
    },
  );

  fastify.get<{ Querystring: { limit?: string } }>(
    "/bills/recent",
    { preHandler: fastify.authenticate },
    async (request) => {
      const limit = Math.min(Number(request.query.limit) || 5, 20);
      return billsRepo.listRecent(limit);
    },
  );

  fastify.get<{ Params: { billNo: string } }>(
    "/bills/:billNo",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const billNo = Number(request.params.billNo);
      const bill = billsRepo.get(billNo);
      if (!bill) return reply.code(404).send({ error: "Bill not found" });
      return {
        bill,
        lines: billsRepo.getLines(billNo),
        amountInWords: amountInWords(bill.grand_total),
      };
    },
  );

  // Print-ready invoice (also serves duplicate/reprint requests — same bill, regenerated on demand).
  fastify.get<{ Params: { billNo: string } }>(
    "/bills/:billNo/pdf",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const buffer = await generateInvoicePdf(Number(request.params.billNo));
        return reply
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", `inline; filename="invoice-${request.params.billNo}.pdf"`)
          .send(buffer);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // Direct walk-in billing (Phase 2) — cashier enters a bill without an attendant pending transaction.
  // Also used by field_operator's pump-side "settle now" self-checkout (cash/card only — see below).
  fastify.post<{
    Body: {
      paymentType: string;
      customerCode?: string;
      vehicleNo?: string;
      orderNo?: string;
      pumpCode?: string;
      clientRef?: string;
      lines: WalkInLineInput[];
    };
  }>(
    "/bills",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator", "field_operator") },
    async (request, reply) => {
      const { paymentType, customerCode, vehicleNo, orderNo, pumpCode, clientRef, lines } = request.body ?? {};
      if (!paymentType || !lines?.length) {
        return reply.code(400).send({ error: "paymentType and at least one line are required" });
      }
      // A field_operator settles their own pump-side sale directly, but can't extend credit —
      // that requires the customer verification the cashier/billing screen does.
      if (paymentType === "credit" && request.user.role === "field_operator") {
        return reply.code(403).send({ error: "Field operators cannot create credit sales" });
      }
      try {
        const result = createWalkInBill({
          cashierId: request.user.sub,
          paymentType,
          customerCode,
          vehicleNo,
          orderNo,
          pumpCode,
          clientRef,
          lines,
        });
        return reply.code(201).send(result);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // Cashier accepts payment for a pending transaction (+ optional extra items) -> invoice.
  fastify.post<{
    Body: { pendingId: number; paymentType: string; extraLines?: ExtraLineInput[] };
  }>(
    "/bills/settle",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async (request, reply) => {
      const { pendingId, paymentType, extraLines } = request.body ?? {};
      if (!pendingId || !paymentType) {
        return reply.code(400).send({ error: "pendingId and paymentType are required" });
      }
      try {
        const result = settlePendingTransaction({
          pendingId,
          cashierId: request.user.sub,
          paymentType,
          extraLines,
        });
        return reply.code(201).send(result);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // Legacy BILLCNCS: cancel a bill (admin/manager only — not a cashier self-service action).
  fastify.post<{ Params: { billNo: string } }>(
    "/bills/:billNo/cancel",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      try {
        const bill = cancelBill(Number(request.params.billNo), request.user.sub);
        auditLogsRepo.record({
          user_id: request.user.sub,
          action: "cancel_bill",
          entity_type: "bill",
          entity_id: bill.bill_no,
          details: { grand_total: bill.grand_total },
        });
        return bill;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
