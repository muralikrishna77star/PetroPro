import type { FastifyInstance } from "fastify";
import { billsRepo } from "../repositories/bills.js";
import { tenantsRepo } from "../repositories/tenants.js";
import { amountInWords } from "../services/money.js";
import { generateInvoicePdf } from "../services/invoicePdf.js";
import type { InvoiceTokenPayload } from "../plugins/auth.js";

/** Verifies a QR/share-link token (routes/bills.ts's `/bills/:billNo/share-link`) is well-formed,
 *  unexpired, and actually scoped to the bill being requested — a token minted for bill 100
 *  must not open bill 101 just because someone edited the URL. */
function checkToken(fastify: FastifyInstance, token: string | undefined, billNo: number): boolean {
  if (!token) return false;
  try {
    const payload = fastify.jwt.verify<InvoiceTokenPayload>(token);
    return payload.role === "invoice" && payload.sub === String(billNo);
  } catch {
    return false;
  }
}

/** Public (unauthenticated) invoice viewing — the QR-code invoice flow's landing point. No staff
 *  or customer login involved; access control is entirely the possession of a valid, unexpired
 *  `t` token scoped to this one bill (see checkToken above and `SHARE_LINK_TTL` in routes/
 *  bills.ts). Deliberately separate from routes/bills.ts's staff-only endpoints rather than
 *  reusing them with an extra auth branch, so it's obvious at a glance which routes in this app
 *  are reachable with no login at all. */
export default async function publicInvoiceRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { billNo: string }; Querystring: { t?: string } }>(
    "/public/invoice/:billNo",
    async (request, reply) => {
      const billNo = Number(request.params.billNo);
      if (!checkToken(fastify, request.query.t, billNo)) {
        return reply.code(401).send({ error: "This link has expired or is invalid — ask the counter to share it again" });
      }
      const bill = billsRepo.get(billNo);
      if (!bill) return reply.code(404).send({ error: "Bill not found" });
      const tenant = tenantsRepo.get();
      return {
        bill,
        lines: billsRepo.getLines(billNo),
        amountInWords: amountInWords(bill.grand_total),
        tenant: {
          name: tenant.name,
          address_line1: tenant.address_line1,
          address_line2: tenant.address_line2,
          tagline: tenant.tagline,
          gst_no: tenant.gst_no,
        },
      };
    },
  );

  fastify.get<{ Params: { billNo: string }; Querystring: { t?: string } }>(
    "/public/invoice/:billNo/pdf",
    async (request, reply) => {
      const billNo = Number(request.params.billNo);
      if (!checkToken(fastify, request.query.t, billNo)) {
        return reply.code(401).send({ error: "This link has expired or is invalid — ask the counter to share it again" });
      }
      try {
        const buffer = await generateInvoicePdf(billNo);
        return reply
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", `inline; filename="invoice-${billNo}.pdf"`)
          .send(buffer);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );
}
