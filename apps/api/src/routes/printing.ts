import type { FastifyInstance } from "fastify";
import type { PrintJobStatus, ReceiptSettings, TerminalPrinterSettings } from "@petropro/shared-types";
import { config } from "../config.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { billsRepo } from "../repositories/bills.js";
import { DEFAULT_TERMINAL_SETTINGS, cleanTerminalSettings, printJobsRepo, printSettingsRepo } from "../repositories/printing.js";
import { previewPrint, PrintRefused, requestPrint, retryPrint, testPrint } from "../services/printing.js";
import { buildBillReceipt } from "../services/receipt.js";
import { renderReceiptPdf } from "../services/billReceiptPdf.js";

const TERMINAL_ID = /^[A-Za-z0-9_-]{8,64}$/;

function terminalIdOf(value: unknown): string | null {
  return typeof value === "string" && TERMINAL_ID.test(value) ? value : null;
}

export default async function printingRoutes(fastify: FastifyInstance) {
  // The customer and QR-link tokens have other audiences, so printing names the staff roles.
  const staff = { preHandler: fastify.requireRole("super_admin", "owner", "operator", "field_operator") };
  const admin = { preHandler: fastify.requireRole("super_admin", "owner") };

  const qrMinter = (billNo: number) => (days: number) => {
    const token = fastify.jwt.sign({ sub: String(billNo), role: "invoice" }, { expiresIn: `${days}d` });
    return `${config.webAppUrl}/i/${billNo}?t=${token}`;
  };

  fastify.get("/print/settings", staff, async () => printSettingsRepo.getReceipt());

  fastify.put<{ Body: Partial<ReceiptSettings> }>("/print/settings", admin, async (request, reply) => {
    try {
      const settings = printSettingsRepo.saveReceipt(request.body ?? {});
      auditLogsRepo.record({ user_id: request.user.sub, action: "update_print_settings", entity_type: "print_settings", entity_id: "receipt" });
      return settings;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  fastify.get("/print/terminals", admin, async () => printSettingsRepo.listTerminals());

  fastify.get<{ Params: { id: string } }>("/print/terminals/:id", staff, async (request, reply) => {
    const id = terminalIdOf(request.params.id);
    if (!id) return reply.code(400).send({ error: "Unknown terminal" });
    return printSettingsRepo.getTerminal(id);
  });

  fastify.put<{ Params: { id: string }; Body: Partial<TerminalPrinterSettings> }>("/print/terminals/:id", admin, async (request, reply) => {
    const id = terminalIdOf(request.params.id);
    if (!id) return reply.code(400).send({ error: "Unknown terminal" });
    try {
      const settings = printSettingsRepo.saveTerminal(id, request.body ?? {});
      auditLogsRepo.record({ user_id: request.user.sub, action: "update_printer", entity_type: "print_terminal", entity_id: id });
      return settings;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Prints what the form shows, so a setting can be tried before it's saved.
  fastify.post<{ Body: { settings?: Partial<TerminalPrinterSettings> } }>("/print/test", admin, async (request, reply) => {
    try {
      return testPrint(cleanTerminalSettings(request.body?.settings ?? {}, DEFAULT_TERMINAL_SETTINGS));
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  fastify.get<{ Params: { billNo: string }; Querystring: { terminal_id?: string } }>("/bills/:billNo/receipt", staff, async (request, reply) => {
    const billNo = Number(request.params.billNo);
    try {
      return previewPrint(billNo, terminalIdOf(request.query.terminal_id) ?? undefined, qrMinter(billNo));
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  fastify.get<{ Params: { billNo: string }; Querystring: { terminal_id?: string } }>("/bills/:billNo/receipt.pdf", staff, async (request, reply) => {
    const billNo = Number(request.params.billNo);
    if (!billsRepo.get(billNo)) return reply.code(404).send({ error: "Bill not found" });
    const settings = printSettingsRepo.getReceipt();
    const terminalId = terminalIdOf(request.query.terminal_id);
    const terminal = printSettingsRepo.getTerminal(terminalId ?? undefined);
    const original = printJobsRepo.getOriginal(billNo);
    const doc = buildBillReceipt(billNo, {
      kind: original?.status === "sent" ? "duplicate" : "original",
      settings,
      terminal,
      qrUrl: terminal.show_qr ? qrMinter(billNo)(settings.qr_link_days) : null,
    });
    const buffer = await renderReceiptPdf(doc, terminal, settings);
    auditLogsRepo.record({
      user_id: request.user.sub,
      action: "download_receipt_pdf",
      entity_type: "bill",
      entity_id: billNo,
      details: { terminal: terminalId },
    });
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="receipt-${billNo}.pdf"`)
      .send(buffer);
  });

  fastify.get<{ Params: { billNo: string } }>("/bills/:billNo/print-jobs", staff, async (request, reply) => {
    const billNo = Number(request.params.billNo);
    if (!billsRepo.get(billNo)) return reply.code(404).send({ error: "Bill not found" });
    return printJobsRepo.listForBill(billNo);
  });

  fastify.post<{ Params: { billNo: string }; Body: { request_key?: string; terminal_id?: string; connection?: string } }>(
    "/bills/:billNo/print-jobs",
    staff,
    async (request, reply) => {
      const billNo = Number(request.params.billNo);
      const key = request.body?.request_key;
      if (typeof key !== "string" || key.length < 8 || key.length > 80) {
        return reply.code(400).send({ error: "A request key is required" });
      }
      if (!billsRepo.get(billNo)) return reply.code(404).send({ error: "Bill not found" });
      try {
        return requestPrint({
          billNo,
          terminalId: terminalIdOf(request.body?.terminal_id),
          connection: typeof request.body?.connection === "string" ? request.body.connection.slice(0, 20) : undefined,
          requestKey: key,
          userId: request.user.sub,
          mintQrUrl: qrMinter(billNo),
        });
      } catch (err) {
        if (err instanceof PrintRefused) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  fastify.get("/print-jobs/unfinished", staff, async () => printJobsRepo.listUnfinished());

  fastify.post<{ Params: { id: string }; Body: { terminal_id?: string; connection?: string } }>("/print-jobs/:id/retry", staff, async (request, reply) => {
    const job = printJobsRepo.get(Number(request.params.id));
    if (!job) return reply.code(404).send({ error: "Print job not found" });
    try {
      return retryPrint(
        job.id,
        terminalIdOf(request.body?.terminal_id),
        typeof request.body?.connection === "string" ? request.body.connection.slice(0, 20) : undefined,
        qrMinter(job.bill_no),
      );
    } catch (err) {
      if (err instanceof PrintRefused) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string }; Body: { status?: PrintJobStatus; error?: string } }>("/print-jobs/:id", staff, async (request, reply) => {
    const job = printJobsRepo.get(Number(request.params.id));
    if (!job) return reply.code(404).send({ error: "Print job not found" });
    const status = request.body?.status;
    if (status !== "sent" && status !== "failed") return reply.code(400).send({ error: "Status must be sent or failed" });
    return printJobsRepo.report(job.id, status, typeof request.body?.error === "string" ? request.body.error.slice(0, 300) : null);
  });
}
