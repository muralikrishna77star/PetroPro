import type { FastifyInstance } from "fastify";
import { communicationSettingsRepo, type CommunicationSettings } from "../repositories/communicationSettings.js";
import { communicationLogRepo, type CommunicationChannel, type CommunicationStatus } from "../repositories/communicationLog.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

const CHANNELS: CommunicationChannel[] = ["whatsapp", "whatsapp_business", "email", "sms", "share_pdf"];
const STATUSES: CommunicationStatus[] = ["sent", "failed"];

export default async function communicationRoutes(fastify: FastifyInstance) {
  // Read is open to any signed-in staff — the billing screen (operator role included) needs the
  // template/country-code/auto-open settings client-side to build the wa.me link.
  fastify.get("/communication/settings", { preHandler: fastify.authenticate }, async () =>
    communicationSettingsRepo.get(),
  );

  fastify.put<{ Body: Partial<CommunicationSettings> }>(
    "/communication/settings",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request) => {
      const updated = communicationSettingsRepo.update(request.body ?? {});
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "update_communication_settings",
        entity_type: "communication_settings",
        details: request.body,
      });
      return updated;
    },
  );

  // Recorded client-side after attempting a send (WhatsApp Web opened, Share sheet used, etc.) —
  // there's no server-side delivery confirmation for any Community-edition channel, so `status`
  // reflects what the browser could observe, not a WhatsApp read/delivery receipt.
  fastify.post<{
    Body: {
      bill_no: number;
      customer_code?: string | null;
      mobile_number?: string | null;
      channel: string;
      status: string;
      remarks?: string | null;
    };
  }>("/communication/log", { preHandler: fastify.requireRole("super_admin", "owner", "operator") }, async (request, reply) => {
    const { bill_no, customer_code, mobile_number, channel, status, remarks } = request.body ?? {};
    if (!bill_no) return reply.code(400).send({ error: "bill_no is required" });
    if (!CHANNELS.includes(channel as CommunicationChannel)) {
      return reply.code(400).send({ error: `Unknown channel: ${channel}` });
    }
    if (!STATUSES.includes(status as CommunicationStatus)) {
      return reply.code(400).send({ error: `Unknown status: ${status}` });
    }
    return communicationLogRepo.record({
      bill_no,
      customer_code,
      mobile_number,
      channel: channel as CommunicationChannel,
      status: status as CommunicationStatus,
      remarks,
    });
  });

  fastify.get<{ Querystring: { bill_no?: string } }>(
    "/communication/log",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request) => {
      const { bill_no } = request.query;
      return bill_no ? communicationLogRepo.listByBill(Number(bill_no)) : communicationLogRepo.list();
    },
  );
}
