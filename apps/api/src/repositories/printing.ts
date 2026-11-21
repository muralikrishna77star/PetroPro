import type {
  OilCompany,
  PrintStation,
  StationTest,
  PrintJob,
  PrintJobStatus,
  PrintKind,
  PrinterConnection,
  PrinterEncoding,
  ReceiptLogo,
  ReceiptSettings,
  TerminalPrinterSettings,
} from "@petropro/shared-types";
import { db } from "../db/client.js";

const OIL_COMPANIES: OilCompany[] = ["iocl", "hpcl", "bpcl"];
/** 1.5 cm is about as small as a logo stays recognisable. 72 mm is the printable width of 80 mm paper,
 *  and 576 dots, the most an 80 mm printer can draw across. */
const LOGO_MIN_MM = 15;
const LOGO_MAX_MM = 72;

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  header_lines: [],
  show_tagline: true,
  show_gstin: true,
  footer_text: "THANK YOU VISIT AGAIN",
  oil_company: null,
  logo_width_mm: 30,
  logo: null,
  qr_link_days: 7,
  show_customer: true,
  show_vehicle: true,
  show_cashier: true,
  show_mileage: true,
  show_tax_breakup: true,
  festival_greetings: true,
  qty_decimals: 2,
};

/** Browser printing works with no setup and no bridge, so a new terminal can always print something.
 *  48 characters is Font A on the common 72 mm printable width of an 80 mm printer. */
export const DEFAULT_TERMINAL_SETTINGS: TerminalPrinterSettings = {
  terminal_name: "",
  printer_name: "",
  printer_model: "",
  connection: "browser",
  host: "",
  port: 9100,
  windows_printer: "",
  paper_mm: 80,
  printable_mm: 72,
  chars_per_line: 48,
  encoding: "cp437",
  show_logo: false,
  show_qr: false,
  auto_cut: true,
  auto_print: false,
  copies: 1,
  print_station: false,
  station_id: "",
};

const CONNECTIONS: PrinterConnection[] = ["browser", "bridge_lan", "bridge_usb", "webusb", "bluetooth", "station"];
const TERMINAL_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** A station that asked for work this recently is listening. It asks at least every 25 seconds. */
const STATION_ONLINE_SECONDS = 45;
const ENCODINGS: PrinterEncoding[] = ["ascii", "cp437", "cp858"];

function text(value: unknown, max: number, fallback: string): string {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function cleanLogo(value: unknown, fallback: ReceiptLogo | null): ReceiptLogo | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === undefined) return fallback;
  const logo = value as ReceiptLogo;
  const width = int(logo.width, 8, 576, 0);
  // A framed logo is square, so it can be as tall as the widest one is wide.
  const height = int(logo.height, 1, 576, 0);
  if (!width || !height || typeof logo.raster_base64 !== "string" || typeof logo.preview_data_url !== "string") {
    throw new Error("That logo couldn't be read");
  }
  if (Buffer.from(logo.raster_base64, "base64").length !== Math.ceil(width / 8) * height) {
    throw new Error("That logo's size doesn't match its image data");
  }
  if (!/^data:image\/png;base64,/.test(logo.preview_data_url) || logo.preview_data_url.length > 200_000) {
    throw new Error("That logo's preview is too large");
  }
  return { width, height, raster_base64: logo.raster_base64, preview_data_url: logo.preview_data_url };
}

export function cleanReceiptSettings(input: Partial<ReceiptSettings>, base: ReceiptSettings): ReceiptSettings {
  return {
    header_lines: Array.isArray(input.header_lines)
      ? input.header_lines.filter((l) => typeof l === "string" && l.trim()).slice(0, 8).map((l) => l.trim().slice(0, 64))
      : base.header_lines,
    show_tagline: bool(input.show_tagline, base.show_tagline),
    show_gstin: bool(input.show_gstin, base.show_gstin),
    footer_text: text(input.footer_text, 120, base.footer_text),
    oil_company:
      input.oil_company === null || (OIL_COMPANIES as unknown[]).includes(input.oil_company)
        ? (input.oil_company ?? null)
        : base.oil_company,
    logo_width_mm: (() => {
      const mm = Number(input.logo_width_mm);
      return input.logo_width_mm !== undefined && Number.isFinite(mm) && mm >= LOGO_MIN_MM && mm <= LOGO_MAX_MM
        ? Math.round(mm * 10) / 10
        : base.logo_width_mm;
    })(),
    logo: cleanLogo(input.logo, base.logo),
    qr_link_days: int(input.qr_link_days, 1, 90, base.qr_link_days),
    show_customer: bool(input.show_customer, base.show_customer),
    show_vehicle: bool(input.show_vehicle, base.show_vehicle),
    show_cashier: bool(input.show_cashier, base.show_cashier),
    show_mileage: bool(input.show_mileage, base.show_mileage),
    show_tax_breakup: bool(input.show_tax_breakup, base.show_tax_breakup),
    festival_greetings: bool(input.festival_greetings, base.festival_greetings),
    qty_decimals: int(input.qty_decimals, 2, 3, base.qty_decimals),
  };
}

export function cleanTerminalSettings(input: Partial<TerminalPrinterSettings>, base: TerminalPrinterSettings): TerminalPrinterSettings {
  const host = text(input.host, 64, base.host);
  if (host && !/^[A-Za-z0-9.-]+$/.test(host)) throw new Error("The printer address isn't valid");
  const paper = input.paper_mm === 58 || input.paper_mm === 80 ? input.paper_mm : base.paper_mm;
  const connection = CONNECTIONS.includes(input.connection as PrinterConnection) ? (input.connection as PrinterConnection) : base.connection;
  const stationId = typeof input.station_id === "string" ? (TERMINAL_ID.test(input.station_id) ? input.station_id : "") : base.station_id;
  const printStation = bool(input.print_station, base.print_station);
  // A station prints unattended, so it needs a printer it can reach without a dialog, and it
  // can't hand its own work on to yet another station.
  if (printStation && (connection === "browser" || connection === "station")) {
    throw new Error("A print station prints on its own printer. Choose a USB, LAN or Bluetooth printer for it first.");
  }
  return {
    terminal_name: text(input.terminal_name, 40, base.terminal_name),
    printer_name: text(input.printer_name, 60, base.printer_name),
    printer_model: text(input.printer_model, 60, base.printer_model),
    connection,
    host,
    port: int(input.port, 1, 65535, base.port),
    windows_printer: text(input.windows_printer, 120, base.windows_printer),
    paper_mm: paper,
    printable_mm: int(input.printable_mm, 40, 80, base.printable_mm),
    chars_per_line: int(input.chars_per_line, 24, 64, base.chars_per_line),
    encoding: ENCODINGS.includes(input.encoding as PrinterEncoding) ? (input.encoding as PrinterEncoding) : base.encoding,
    show_logo: bool(input.show_logo, base.show_logo),
    show_qr: bool(input.show_qr, base.show_qr),
    auto_cut: bool(input.auto_cut, base.auto_cut),
    auto_print: bool(input.auto_print, base.auto_print),
    copies: int(input.copies, 1, 5, base.copies),
    print_station: printStation,
    station_id: connection === "station" ? stationId : "",
  };
}

export const printSettingsRepo = {
  getReceipt(): ReceiptSettings {
    const row = db.prepare("SELECT settings FROM print_settings WHERE id = 1").get() as { settings: string } | undefined;
    return { ...DEFAULT_RECEIPT_SETTINGS, ...(row ? (JSON.parse(row.settings) as Partial<ReceiptSettings>) : {}) };
  },

  saveReceipt(input: Partial<ReceiptSettings>): ReceiptSettings {
    const settings = cleanReceiptSettings(input, printSettingsRepo.getReceipt());
    db.prepare(
      "INSERT INTO print_settings (id, settings) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET settings = excluded.settings",
    ).run(JSON.stringify(settings));
    return settings;
  },

  getTerminal(terminalId: string | undefined): TerminalPrinterSettings {
    if (!terminalId) return DEFAULT_TERMINAL_SETTINGS;
    const row = db.prepare("SELECT settings FROM print_terminals WHERE terminal_id = ?").get(terminalId) as { settings: string } | undefined;
    return { ...DEFAULT_TERMINAL_SETTINGS, ...(row ? (JSON.parse(row.settings) as Partial<TerminalPrinterSettings>) : {}) };
  },

  saveTerminal(terminalId: string, input: Partial<TerminalPrinterSettings>): TerminalPrinterSettings {
    const settings = cleanTerminalSettings(input, printSettingsRepo.getTerminal(terminalId));
    db.prepare(
      `INSERT INTO print_terminals (terminal_id, settings, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(terminal_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
    ).run(terminalId, JSON.stringify(settings));
    return settings;
  },

  /** Terminals that print for others, with whether each is listening right now. */
  listStations(): PrintStation[] {
    const rows = db
      .prepare(
        `SELECT terminal_id, settings, last_seen, (last_seen IS NOT NULL AND last_seen >= datetime('now', ?)) AS online
         FROM print_terminals ORDER BY updated_at DESC`,
      )
      .all(`-${STATION_ONLINE_SECONDS} seconds`) as unknown as { terminal_id: string; settings: string; last_seen: string | null; online: number }[];
    return rows
      .map((r) => ({ ...r, parsed: { ...DEFAULT_TERMINAL_SETTINGS, ...(JSON.parse(r.settings) as Partial<TerminalPrinterSettings>) } }))
      .filter((r) => r.parsed.print_station)
      .map((r) => ({ terminal_id: r.terminal_id, name: r.parsed.terminal_name || "Counter printer", last_seen: r.last_seen, online: r.online === 1 }));
  },

  getStation(terminalId: string): PrintStation | undefined {
    return printSettingsRepo.listStations().find((s) => s.terminal_id === terminalId);
  },

  /** A station asking for work is a station that's listening. */
  touchStation(terminalId: string): void {
    db.prepare("UPDATE print_terminals SET last_seen = datetime('now') WHERE terminal_id = ?").run(terminalId);
  },

  listTerminals(): { terminal_id: string; settings: TerminalPrinterSettings; updated_at: string }[] {
    const rows = db.prepare("SELECT terminal_id, settings, updated_at FROM print_terminals ORDER BY updated_at DESC").all() as unknown as {
      terminal_id: string;
      settings: string;
      updated_at: string;
    }[];
    return rows.map((r) => ({
      terminal_id: r.terminal_id,
      updated_at: r.updated_at,
      settings: { ...DEFAULT_TERMINAL_SETTINGS, ...(JSON.parse(r.settings) as Partial<TerminalPrinterSettings>) },
    }));
  },
};

export const printJobsRepo = {
  get(id: number): PrintJob | undefined {
    return db.prepare("SELECT * FROM print_jobs WHERE id = ?").get(id) as unknown as PrintJob | undefined;
  },

  getByRequestKey(key: string): PrintJob | undefined {
    return db.prepare("SELECT * FROM print_jobs WHERE request_key = ?").get(key) as unknown as PrintJob | undefined;
  },

  listForBill(billNo: number): PrintJob[] {
    return db.prepare("SELECT * FROM print_jobs WHERE bill_no = ? ORDER BY id").all(billNo) as unknown as PrintJob[];
  },

  listUnfinished(limit = 50): PrintJob[] {
    return db
      .prepare("SELECT * FROM print_jobs WHERE status != 'sent' ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as PrintJob[];
  },

  getOriginal(billNo: number): PrintJob | undefined {
    return db.prepare("SELECT * FROM print_jobs WHERE bill_no = ? AND kind = 'original'").get(billNo) as unknown as PrintJob | undefined;
  },

  latestDuplicate(billNo: number): PrintJob | undefined {
    return db
      .prepare("SELECT * FROM print_jobs WHERE bill_no = ? AND kind = 'duplicate' ORDER BY id DESC LIMIT 1")
      .get(billNo) as unknown as PrintJob | undefined;
  },

  create(input: {
    bill_no: number;
    kind: PrintKind;
    terminal_id: string | null;
    connection: string;
    copies: number;
    request_key: string;
    created_by: string;
    /** A job for a print station starts queued, and the station prints it. */
    station_id?: string | null;
  }): PrintJob {
    const result = db
      .prepare(
        `INSERT INTO print_jobs (bill_no, kind, terminal_id, connection, copies, request_key, created_by, station_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.bill_no,
        input.kind,
        input.terminal_id,
        input.connection,
        input.copies,
        input.request_key,
        input.created_by,
        input.station_id ?? null,
        input.station_id ? "queued" : "pending",
      );
    return printJobsRepo.get(Number(result.lastInsertRowid))!;
  },

  /** Hands a pending or failed job to a sender, so a retry reprints the same job. With a station, the
   *  job goes back in that station's queue instead. */
  claim(id: number, terminalId: string | null, connection: string, stationId: string | null = null): PrintJob {
    db.prepare(
      `UPDATE print_jobs SET status = ?, attempts = attempts + 1, error = NULL, terminal_id = ?, connection = ?,
         station_id = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(stationId ? "queued" : "pending", terminalId, connection, stationId, id);
    return printJobsRepo.get(id)!;
  },

  /** The oldest job waiting for this station, now marked as being printed there. The status check in
   *  the update means two windows on the same station can't both take it. */
  takeForStation(stationId: string, connection: string): PrintJob | undefined {
    for (;;) {
      const next = db
        .prepare("SELECT id FROM print_jobs WHERE station_id = ? AND status = 'queued' ORDER BY id LIMIT 1")
        .get(stationId) as { id: number } | undefined;
      if (!next) return undefined;
      const taken = db
        .prepare(
          `UPDATE print_jobs SET status = 'pending', terminal_id = ?, connection = ?, updated_at = datetime('now')
           WHERE id = ? AND status = 'queued'`,
        )
        .run(stationId, connection, next.id);
      if (taken.changes === 1) return printJobsRepo.get(next.id);
    }
  },

  /** A job that reached the printer stays that way, so a late failure report can't invite a second print. */
  report(id: number, status: PrintJobStatus, error: string | null): PrintJob {
    db.prepare(
      `UPDATE print_jobs SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND status != 'sent'`,
    ).run(status, status === "failed" ? error : null, id);
    return printJobsRepo.get(id)!;
  },
};

/** Test pages sent to a print station from another terminal's Printer Settings. Not print jobs: no
 *  bill, nothing to audit. */
export const stationTestsRepo = {
  create(stationId: string, requestedBy: string): StationTest {
    const result = db.prepare("INSERT INTO print_station_tests (station_id, requested_by) VALUES (?, ?)").run(stationId, requestedBy);
    return stationTestsRepo.get(Number(result.lastInsertRowid))!;
  },

  get(id: number): StationTest | undefined {
    return db.prepare("SELECT id, station_id, status, error, created_at FROM print_station_tests WHERE id = ?").get(id) as unknown as
      | StationTest
      | undefined;
  },

  take(stationId: string): (StationTest & { requested_by: string }) | undefined {
    const next = db
      .prepare("SELECT id, requested_by FROM print_station_tests WHERE station_id = ? AND status = 'queued' ORDER BY id LIMIT 1")
      .get(stationId) as { id: number; requested_by: string } | undefined;
    if (!next) return undefined;
    const taken = db
      .prepare("UPDATE print_station_tests SET status = 'pending', updated_at = datetime('now') WHERE id = ? AND status = 'queued'")
      .run(next.id);
    return taken.changes === 1 ? { ...stationTestsRepo.get(next.id)!, requested_by: next.requested_by } : undefined;
  },

  report(id: number, status: "sent" | "failed", error: string | null): StationTest | undefined {
    db.prepare("UPDATE print_station_tests SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND status != 'sent'").run(
      status,
      status === "failed" ? error : null,
      id,
    );
    return stationTestsRepo.get(id);
  },
};
