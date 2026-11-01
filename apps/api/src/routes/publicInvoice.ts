import type { FastifyInstance } from "fastify";
import { billsRepo } from "../repositories/bills.js";
import { tenantsRepo } from "../repositories/tenants.js";
import { amountInWords } from "../services/money.js";
import { generateInvoicePdf } from "../services/invoicePdf.js";
import { communicationSettingsRepo } from "../repositories/communicationSettings.js";
import { communicationLogRepo } from "../repositories/communicationLog.js";
import { config } from "../config.js";
import type { InvoiceTokenPayload } from "../plugins/auth.js";

/** Same rule as web's lib/communication/mobileNumber.ts: a bare 10-digit number gets the
 *  default country code, anything 11-15 digits is taken as already including one. */
function normalizeMobile(raw: string | undefined, countryCode: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  const full = digits.length === 10 ? `${countryCode}${digits}` : digits;
  return full.length >= 11 && full.length <= 15 ? full : null;
}

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
      const comms = communicationSettingsRepo.get();
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
        whatsapp: {
          enabled: comms.qr_whatsapp_enabled,
          default_country_code: comms.default_country_code,
          link_days: comms.qr_whatsapp_link_days,
        },
      };
    },
  );

  // "Send to my WhatsApp" — the customer chooses this themselves on the scanned page and types
  // their own number. Without the Business API nothing can be pushed to a number, so this returns
  // a wa.me link the customer's phone opens (their own chat, i.e. "message yourself") with a bill
  // link that outlives the QR's 30 minutes — hence the owner-controlled setting and validity.
  fastify.post<{ Params: { billNo: string }; Querystring: { t?: string }; Body: { mobile_number?: string } }>(
    "/public/invoice/:billNo/whatsapp",
    async (request, reply) => {
      const billNo = Number(request.params.billNo);
      if (!checkToken(fastify, request.query.t, billNo)) {
        return reply.code(401).send({ error: "This link has expired or is invalid — ask the counter to share it again" });
      }
      const comms = communicationSettingsRepo.get();
      if (!comms.qr_whatsapp_enabled) {
        return reply.code(403).send({ error: "Sending to WhatsApp isn't enabled at this outlet" });
      }
      const bill = billsRepo.get(billNo);
      if (!bill) return reply.code(404).send({ error: "Bill not found" });
      const mobile = normalizeMobile(request.body?.mobile_number, comms.default_country_code);
      if (!mobile) return reply.code(400).send({ error: "Enter a valid WhatsApp mobile number" });

      const days = comms.qr_whatsapp_link_days;
      const token = fastify.jwt.sign({ sub: String(billNo), role: "invoice" }, { expiresIn: `${days}d` });
      const link = `${config.webAppUrl}/i/${billNo}?t=${token}`;
      const tenant = tenantsRepo.get();
      const text =
        `Invoice #${billNo} from ${tenant.name} for Rs.${bill.grand_total.toFixed(2)}.\n` +
        `View / download: ${link}\n(Link valid for ${days} day${days === 1 ? "" : "s"})`;

      communicationLogRepo.record({
        bill_no: billNo,
        customer_code: bill.customer_code,
        mobile_number: mobile,
        channel: "whatsapp",
        status: "sent",
        remarks: "Customer self-service from QR scan",
      });
      return { whatsappUrl: `https://wa.me/${mobile}?text=${encodeURIComponent(text)}`, expiresInDays: days };
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
