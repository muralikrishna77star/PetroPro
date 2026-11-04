import type { PrintJob, PrintPayload, ReceiptDocument, TerminalPrinterSettings } from "@petropro/shared-types";
import { billsRepo } from "../repositories/bills.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { printJobsRepo, printSettingsRepo } from "../repositories/printing.js";
import { buildBillReceipt, buildTestReceipt, renderText } from "./receipt.js";
import { renderCopies } from "./escpos.js";

/** Long enough for a browser dialog or a slow printer to finish. After this a pending original is
 *  treated as abandoned, so a crashed terminal can't leave a bill unprintable. */
const PENDING_ORIGINAL_MS = 60_000;
/** A second reprint this soon is a double-click or an impatient cashier, not a request for two. */
const REPRINT_GUARD_MS = 10_000;

export class PrintRefused extends Error {}

function sqliteAge(timestamp: string, now: number): number {
  return now - new Date(`${timestamp.replace(" ", "T")}Z`).getTime();
}

function payload(job: PrintJob | null, doc: ReceiptDocument, terminal: TerminalPrinterSettings, copies: number): PrintPayload {
  const logo = printSettingsRepo.getReceipt().logo;
  return {
    job,
    document: doc,
    text: renderText(doc),
    escpos_base64: renderCopies(doc, terminal, terminal.show_logo ? logo : null, copies).toString("base64"),
    settings: terminal,
    logo_preview: terminal.show_logo ? (logo?.preview_data_url ?? null) : null,
  };
}

/**
 * Decides what a print request means, and only ever touches print_jobs. A bill's first print is its
 * original, every later one is a duplicate carrying Petbill's banner and an audit entry, and a retry
 * of a job that never reached the printer stays the same job. Sales, stock and dues aren't involved.
 */
export function requestPrint(input: {
  billNo: number;
  terminalId: string | null;
  connection?: string;
  requestKey: string;
  userId: string;
  mintQrUrl: (days: number) => string;
  now?: number;
}): PrintPayload {
  const now = input.now ?? Date.now();
  if (!billsRepo.get(input.billNo)) throw new Error(`Bill ${input.billNo} not found`);
  const settings = printSettingsRepo.getReceipt();
  const terminal = printSettingsRepo.getTerminal(input.terminalId ?? undefined);
  const connection = input.connection ?? terminal.connection;

  let job = printJobsRepo.getByRequestKey(input.requestKey);
  if (job && job.bill_no !== input.billNo) throw new PrintRefused("That print request belongs to another bill");
  if (!job) {
    const original = printJobsRepo.getOriginal(input.billNo);
    if (!original) {
      job = printJobsRepo.create({
        bill_no: input.billNo,
        kind: "original",
        terminal_id: input.terminalId,
        connection,
        copies: terminal.copies,
        request_key: input.requestKey,
        created_by: input.userId,
      });
    } else if (original.status !== "sent") {
      // Never printed, so printing it now isn't a duplicate. It is only refused while another
      // terminal may be printing it this moment.
      if (original.status === "pending" && sqliteAge(original.updated_at, now) < PENDING_ORIGINAL_MS) {
        throw new PrintRefused(`Bill ${input.billNo} is printing right now. Wait a moment and check the printer.`);
      }
      job = printJobsRepo.claim(original.id, input.terminalId, connection);
    } else {
      const last = printJobsRepo.latestDuplicate(input.billNo);
      if (last && sqliteAge(last.created_at, now) < REPRINT_GUARD_MS) {
        throw new PrintRefused(`Bill ${input.billNo} was reprinted a moment ago. Check the printer before printing again.`);
      }
      job = printJobsRepo.create({
        bill_no: input.billNo,
        kind: "duplicate",
        terminal_id: input.terminalId,
        connection,
        copies: 1,
        request_key: input.requestKey,
        created_by: input.userId,
      });
      auditLogsRepo.record({
        user_id: input.userId,
        action: "reprint_bill",
        entity_type: "bill",
        entity_id: input.billNo,
        details: { print_job: job.id, terminal: input.terminalId, connection },
      });
    }
  }

  const doc = buildBillReceipt(input.billNo, {
    kind: job.kind,
    settings,
    terminal,
    qrUrl: terminal.show_qr ? input.mintQrUrl(settings.qr_link_days) : null,
  });
  return payload(job, doc, terminal, job.copies);
}

/** Sending a job again is only for one that never reached the printer. Anything else is a reprint. */
export function retryPrint(jobId: number, terminalId: string | null, connection: string | undefined, mintQrUrl: (days: number) => string): PrintPayload {
  const existing = printJobsRepo.get(jobId);
  if (!existing) throw new Error(`Print job ${jobId} not found`);
  if (existing.status === "sent") throw new PrintRefused("This already reached the printer. Use Reprint for another copy.");
  const settings = printSettingsRepo.getReceipt();
  const terminal = printSettingsRepo.getTerminal(terminalId ?? undefined);
  const job = printJobsRepo.claim(jobId, terminalId, connection ?? terminal.connection);
  const doc = buildBillReceipt(job.bill_no, {
    kind: job.kind,
    settings,
    terminal,
    qrUrl: terminal.show_qr ? mintQrUrl(settings.qr_link_days) : null,
  });
  return payload(job, doc, terminal, job.copies);
}

/** A preview changes nothing: it shows what a print would produce right now. */
export function previewPrint(billNo: number, terminalId: string | undefined, mintQrUrl: (days: number) => string): PrintPayload {
  if (!billsRepo.get(billNo)) throw new Error(`Bill ${billNo} not found`);
  const settings = printSettingsRepo.getReceipt();
  const terminal = printSettingsRepo.getTerminal(terminalId);
  const original = printJobsRepo.getOriginal(billNo);
  const kind = original?.status === "sent" ? "duplicate" : "original";
  const doc = buildBillReceipt(billNo, { kind, settings, terminal, qrUrl: terminal.show_qr ? mintQrUrl(settings.qr_link_days) : null });
  return payload(null, doc, terminal, 1);
}

export function testPrint(terminal: TerminalPrinterSettings): PrintPayload {
  return payload(null, buildTestReceipt(printSettingsRepo.getReceipt(), terminal), terminal, 1);
}
