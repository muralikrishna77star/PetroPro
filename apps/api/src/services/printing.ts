import type { PrintJob, PrintPayload, PrintStation, ReceiptDocument, StationWork, TerminalPrinterSettings } from "@petropro/shared-types";
import { billsRepo } from "../repositories/bills.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { usersRepo } from "../repositories/users.js";
import { printJobsRepo, printSettingsRepo, stationTestsRepo } from "../repositories/printing.js";
import { buildBillReceipt, buildTestReceipt, renderText } from "./receipt.js";
import { DOTS_PER_MM, renderCopies } from "./escpos.js";

/** Long enough for a browser dialog or a slow printer to finish. After this a pending original is
 *  treated as abandoned, so a crashed terminal can't leave a bill unprintable. */
const PENDING_ORIGINAL_MS = 60_000;
/** A second reprint this soon is a double-click or an impatient cashier, not a request for two. */
const REPRINT_GUARD_MS = 10_000;

export class PrintRefused extends Error {}

function sqliteAge(timestamp: string, now: number): number {
  return now - new Date(`${timestamp.replace(" ", "T")}Z`).getTime();
}

/** `printer` is whatever prints the bytes: this terminal's own printer, or a print station's. A job
 *  sent to a station comes back marked with it, so the terminal that asked doesn't print it too. */
function payload(job: PrintJob | null, doc: ReceiptDocument, printer: TerminalPrinterSettings, copies: number, station: PrintStation | null = null): PrintPayload {
  const logo = printSettingsRepo.getReceipt().logo;
  return {
    job,
    document: doc,
    text: renderText(doc),
    escpos_base64: renderCopies(doc, printer, printer.show_logo ? logo : null, copies).toString("base64"),
    settings: station ? { ...printer, connection: "station" } : printer,
    logo_preview: printer.show_logo ? (logo?.preview_data_url ?? null) : null,
    logo_width_mm: printer.show_logo && logo ? logo.width / DOTS_PER_MM : null,
    station: station ? { id: station.terminal_id, name: station.name } : null,
  };
}

/** Where a terminal's bills print: on its own printer, or on the print station it sends to. A
 *  terminal set to send to a station that no longer exists is refused rather than left waiting. */
function destination(terminal: TerminalPrinterSettings, connection: string): { station: PrintStation | null; printer: TerminalPrinterSettings } {
  if (connection !== "station") return { station: null, printer: terminal };
  if (!terminal.station_id) throw new PrintRefused("Choose the counter printer this device sends to, in Printer Settings.");
  const station = printSettingsRepo.getStation(terminal.station_id);
  if (!station) throw new PrintRefused("The counter printer this device sends to isn't set up as a print station any more. Choose another in Printer Settings.");
  return { station, printer: printSettingsRepo.getTerminal(station.terminal_id) };
}

function stationName(stationId: string | null): string {
  return (stationId && printSettingsRepo.getStation(stationId)?.name) || "the counter printer";
}

/**
 * Decides what a print request means, and only ever touches print_jobs. A bill's first print is its
 * original, every later one is a duplicate carrying Petbill's banner and an audit entry, and a retry
 * of a job that never reached the printer stays the same job. Sales, stock and dues aren't involved.
 * A terminal that sends to a print station gets its job queued there instead of printing it itself.
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
  const { station, printer } = destination(terminal, connection);
  const stationId = station?.terminal_id ?? null;

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
        copies: printer.copies,
        request_key: input.requestKey,
        created_by: input.userId,
        station_id: stationId,
      });
    } else if (original.status !== "sent") {
      // Never printed, so printing it now isn't a duplicate. It is only refused while another
      // terminal may be printing it this moment, or a station is about to.
      const busy = original.status === "pending" || original.status === "queued";
      if (busy && sqliteAge(original.updated_at, now) < PENDING_ORIGINAL_MS) {
        throw new PrintRefused(
          original.status === "queued"
            ? `Bill ${input.billNo} is waiting to print at ${stationName(original.station_id)}.`
            : `Bill ${input.billNo} is printing right now. Wait a moment and check the printer.`,
        );
      }
      job = printJobsRepo.claim(original.id, input.terminalId, connection, stationId);
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
        station_id: stationId,
      });
      auditLogsRepo.record({
        user_id: input.userId,
        action: "reprint_bill",
        entity_type: "bill",
        entity_id: input.billNo,
        details: { print_job: job.id, terminal: input.terminalId, connection, ...(stationId ? { station: stationId } : {}) },
      });
    }
  }

  const doc = buildBillReceipt(input.billNo, {
    kind: job.kind,
    settings,
    terminal: printer,
    qrUrl: printer.show_qr ? input.mintQrUrl(settings.qr_link_days) : null,
  });
  return payload(job, doc, printer, job.copies, station);
}

/** Sending a job again is only for one that never reached the printer. Anything else is a reprint. */
export function retryPrint(jobId: number, terminalId: string | null, connection: string | undefined, mintQrUrl: (days: number) => string): PrintPayload {
  const existing = printJobsRepo.get(jobId);
  if (!existing) throw new Error(`Print job ${jobId} not found`);
  if (existing.status === "sent") throw new PrintRefused("This already reached the printer. Use Reprint for another copy.");
  const settings = printSettingsRepo.getReceipt();
  const terminal = printSettingsRepo.getTerminal(terminalId ?? undefined);
  const chosen = connection ?? terminal.connection;
  const { station, printer } = destination(terminal, chosen);
  const job = printJobsRepo.claim(jobId, terminalId, chosen, station?.terminal_id ?? null);
  const doc = buildBillReceipt(job.bill_no, {
    kind: job.kind,
    settings,
    terminal: printer,
    qrUrl: printer.show_qr ? mintQrUrl(settings.qr_link_days) : null,
  });
  return payload(job, doc, printer, job.copies, station);
}

/**
 * A print station asking for work: a test page someone sent it, or the oldest bill waiting for it.
 * Taking a job marks it as printing here, so no other window takes it too, and the station then
 * reports the outcome like any terminal. Asking also records that this station is listening.
 */
export function takeStationWork(stationId: string, mintQrUrl: (billNo: number) => (days: number) => string): StationWork {
  const station = printSettingsRepo.getStation(stationId);
  if (!station) throw new PrintRefused("This terminal isn't a print station. Turn it on in Printer Settings.");
  printSettingsRepo.touchStation(stationId);
  const printer = printSettingsRepo.getTerminal(stationId);
  const settings = printSettingsRepo.getReceipt();

  const test = stationTestsRepo.take(stationId);
  if (test) {
    const requestedBy = usersRepo.getById(test.requested_by)?.name ?? test.requested_by;
    return { kind: "test", test_id: test.id, requested_by: requestedBy, payload: payload(null, buildTestReceipt(settings, printer), printer, 1) };
  }

  const job = printJobsRepo.takeForStation(stationId, printer.connection);
  if (!job) return { kind: "none" };
  const doc = buildBillReceipt(job.bill_no, {
    kind: job.kind,
    settings,
    terminal: printer,
    qrUrl: printer.show_qr ? mintQrUrl(job.bill_no)(settings.qr_link_days) : null,
  });
  return { kind: "job", payload: payload(job, doc, printer, job.copies) };
}

/** A preview changes nothing: it shows what a print would produce right now. */
export function previewPrint(billNo: number, terminalId: string | undefined, mintQrUrl: (days: number) => string): PrintPayload {
  if (!billsRepo.get(billNo)) throw new Error(`Bill ${billNo} not found`);
  const settings = printSettingsRepo.getReceipt();
  const terminal = printSettingsRepo.getTerminal(terminalId);
  // A terminal that sends to a station previews what that station's printer will print.
  let station: PrintStation | null = null;
  let printer = terminal;
  try {
    ({ station, printer } = destination(terminal, terminal.connection));
  } catch {
    // Not set up yet: preview with this terminal's own settings.
  }
  const original = printJobsRepo.getOriginal(billNo);
  const kind = original?.status === "sent" ? "duplicate" : "original";
  const doc = buildBillReceipt(billNo, { kind, settings, terminal: printer, qrUrl: printer.show_qr ? mintQrUrl(settings.qr_link_days) : null });
  return payload(null, doc, printer, 1, station);
}

export function testPrint(terminal: TerminalPrinterSettings): PrintPayload {
  return payload(null, buildTestReceipt(printSettingsRepo.getReceipt(), terminal), terminal, 1);
}
