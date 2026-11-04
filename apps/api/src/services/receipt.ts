import type {
  PrintKind,
  ReceiptBlock,
  ReceiptDocument,
  ReceiptSettings,
  TerminalPrinterSettings,
} from "@petropro/shared-types";
import { db } from "../db/client.js";
import { billsRepo, type Bill, type BillLine } from "../repositories/bills.js";
import { tenantsRepo } from "../repositories/tenants.js";

/**
 * The thermal receipt, migrated from Petbill's PRNBILDI (first print) and PRINTBIL (duplicate). The
 * figures and their order follow the source, and docs/THERMAL_PRINTING.md lists each deliberate
 * difference: Petbill's frame of "|" characters is gone, the header prints above the bill rather than
 * being fed out for the next one on a continuous roll, and numbers widen instead of overflowing.
 */

const PAYMENT_HEADINGS: Record<string, string> = { cash: "CASH SALES", credit: "CREDIT SALES", upi: "UPI SALES", card: "CARD SALES" };

export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    let rest = word;
    if (line && line.length + 1 + rest.length > width) {
      out.push(line);
      line = "";
    }
    while (rest.length > width) {
      out.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    line = line ? `${line} ${rest}` : rest;
  }
  if (line) out.push(line);
  return out;
}

function amount(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

/** Fits a row into fixed columns when it can, and never cuts a figure when it can't: printing the
 *  wrong amount is worse than using another line. Petbill's fixed pictures printed asterisks. */
function columns(cells: string[], widths: number[], width: number): string[] {
  const fits = cells.every((cell, i) => cell.length <= widths[i]);
  if (fits) return [cells.map((cell, i) => cell.padStart(widths[i])).join("").padStart(width)];
  const joined = cells.filter(Boolean).join(" ");
  if (joined.length <= width) return [joined.padStart(width)];
  return cells.filter(Boolean).map((cell) => cell.padStart(width));
}

function leftRight(left: string, right: string, width: number): string[] {
  if (!right) return wrapText(left, width);
  if (left.length + right.length + 1 <= width) return [left + " ".repeat(width - left.length - right.length) + right];
  return [...wrapText(left, width), ...wrapText(right, width)];
}

/** dd/mm/yyyy, as Petbill's `set date british`. */
function legacyDate(billDate: string): string {
  const [y, m, d] = billDate.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function festivalGreeting(billDate: string): string | null {
  const md = billDate.slice(5, 10);
  if (md === "01-01") return "WISH YOU A HAPPY NEW YEAR";
  if (md === "01-14" || md === "01-15" || md === "01-16") return "WISH YOU A HAPPY PONGAL";
  return null;
}

interface ColumnLayout {
  name: number;
  rate: number;
  qty: number;
  amt: number;
  base: number;
  vat: number;
  tax: number;
  /** Too narrow for the name and three figures, so the name takes its own line. */
  nameAbove: boolean;
}

function layoutFor(width: number): ColumnLayout {
  const rate = 8;
  const qty = 8;
  const amt = 10;
  const name = width - rate - qty - amt;
  return { name, rate, qty, amt, base: 10, vat: 8, tax: 10, nameAbove: name < 8 };
}

function lineBlocks(line: BillLine, itemName: string, width: number, showTax: boolean, qtyDecimals: number): string[] {
  const layout = layoutFor(width);
  const out: string[] = [];
  const figures = [amount(line.rate), amount(line.qty, qtyDecimals), amount(line.amount)];
  const figureWidths = [layout.rate, layout.qty, layout.amt];
  const inline = !layout.nameAbove && itemName.length <= layout.name && figures.every((f, i) => f.length <= figureWidths[i]);
  if (inline) {
    out.push(itemName.padEnd(layout.name) + figures.map((f, i) => f.padStart(figureWidths[i])).join(""));
  } else {
    out.push(...wrapText(itemName, width));
    out.push(...columns(figures, figureWidths, width));
  }
  // Petbill prints this row only for a line that carries tax.
  if (showTax && line.tax_amount > 0) {
    out.push(
      ...columns(
        [amount(line.amount - line.tax_amount), amount(line.tax_percent), amount(line.tax_amount)],
        [layout.base, layout.vat, layout.tax],
        Math.min(width, layout.base + layout.vat + layout.tax),
      ),
    );
  }
  return out;
}

interface MileageRow {
  odometer_prev: number | null;
  odometer_curr: number;
  mileage: number | null;
}

function nameLookup(bill: Bill, lines: BillLine[]) {
  const items = new Map(
    (db.prepare("SELECT code, name FROM items").all() as unknown as { code: string; name: string }[]).map((r) => [r.code, r.name]),
  );
  const customer = bill.customer_code
    ? (db.prepare("SELECT name, print_name FROM customers WHERE code = ?").get(bill.customer_code) as
        | { name: string; print_name: string | null }
        | undefined)
    : undefined;
  const cashier = bill.user_id
    ? (db.prepare("SELECT name FROM users WHERE user_id = ?").get(bill.user_id) as { name: string } | undefined)
    : undefined;
  const mileage = db
    .prepare("SELECT odometer_prev, odometer_curr, mileage FROM mileage_log WHERE bill_no = ? ORDER BY id")
    .all(bill.bill_no) as unknown as MileageRow[];
  return {
    itemName: (code: string) => items.get(code) ?? code,
    customerName: customer ? customer.print_name?.trim() || customer.name : (bill.customer_code ?? null),
    cashierName: cashier?.name ?? null,
    mileage,
    lines,
  };
}

export function headerBlocks(settings: ReceiptSettings, terminal: TerminalPrinterSettings): ReceiptBlock[] {
  const tenant = tenantsRepo.get();
  const blocks: ReceiptBlock[] = [];
  if (terminal.show_logo && settings.logo) blocks.push({ kind: "logo" });
  const width = terminal.chars_per_line;
  // A long name stays readable at normal width rather than being cut at double width.
  const nameFitsDouble = tenant.name.length * 2 <= width;
  for (const text of wrapText(tenant.name, width)) {
    blocks.push({ kind: "text", text, align: "center", bold: true, double: nameFitsDouble });
  }
  const extras = [
    settings.show_tagline ? tenant.tagline : null,
    tenant.address_line1,
    tenant.address_line2,
    ...settings.header_lines,
    settings.show_gstin && tenant.gst_no ? `GSTIN: ${tenant.gst_no}` : null,
  ];
  for (const extra of extras) {
    if (!extra?.trim()) continue;
    for (const text of wrapText(extra, width)) blocks.push({ kind: "text", text, align: "center" });
  }
  return blocks;
}

export function buildBillReceipt(
  billNo: number,
  opts: { kind: PrintKind; settings: ReceiptSettings; terminal: TerminalPrinterSettings; qrUrl?: string | null },
): ReceiptDocument {
  const bill = billsRepo.get(billNo);
  if (!bill) throw new Error(`Bill ${billNo} not found`);
  const lines = billsRepo.getLines(billNo);
  const { settings, terminal, kind } = opts;
  const width = terminal.chars_per_line;
  const names = nameLookup(bill, lines);

  const blocks: ReceiptBlock[] = headerBlocks(settings, terminal);
  const text = (t: string, extra: Partial<Extract<ReceiptBlock, { kind: "text" }>> = {}) =>
    blocks.push({ kind: "text", text: t, align: "left", ...extra });
  const rule = () => blocks.push({ kind: "rule" });

  // PRINTBIL, the duplicate path, deliberately has no greeting; PRNBILDI does.
  if (kind === "original" && settings.festival_greetings) {
    const greeting = festivalGreeting(bill.bill_date);
    if (greeting) text(greeting, { align: "center" });
  }
  rule();
  if (kind === "duplicate") text("DUPLICATE BILL", { align: "center", bold: true });
  if (bill.status === "cancelled") text("** CANCELLED **", { align: "center", bold: true });

  const heading = PAYMENT_HEADINGS[bill.payment_type] ?? `${bill.payment_type.toUpperCase()} SALES`;
  const showOrder = bill.payment_type === "credit" && bill.order_no;
  for (const row of leftRight(heading, showOrder ? `ORD NO. ${bill.order_no}` : "", width)) text(row);
  for (const row of leftRight(`Bill No. ${bill.bill_no}`, `DT :${legacyDate(bill.bill_date)}`, width)) text(row);
  // Bills made before local_time existed fall back to bill_date, which holds UTC on those, and local
  // time on imported ones. The two can't be told apart.
  const time = bill.local_time ?? bill.bill_date.slice(11, 19);
  if (time && time !== "00:00:00") text(`Time :${time}`);
  if (bill.legacy_bill_no) text(`Petbill Bill No. ${bill.legacy_bill_no}`);
  rule();

  const layout = layoutFor(width);
  const showTax = settings.show_tax_breakup;
  const anyTax = showTax && lines.some((l) => l.tax_amount > 0);
  text(
    layout.nameAbove
      ? ["Rate".padStart(layout.rate), "Qty".padStart(layout.qty), "Amt".padStart(layout.amt)].join("").padStart(width)
      : "Item".padEnd(layout.name) + "Rate".padStart(layout.rate) + "Qty".padStart(layout.qty) + "Amt".padStart(layout.amt),
    { bold: true },
  );
  if (anyTax) {
    text("Bas.Amt".padStart(layout.base) + "Vat%".padStart(layout.vat) + "T.Amt".padStart(layout.tax), { bold: true });
  }
  for (const line of lines) {
    for (const row of lineBlocks(line, names.itemName(line.item_code), width, showTax, settings.qty_decimals)) text(row);
  }
  rule();

  if (anyTax) {
    // The stored figures, by the owner's decision, so these add up to the total and match the A5
    // invoice. Petbill adds rate_pretax * qty here, which drifts because that rate is rounded.
    for (const row of leftRight("Amount", amount(bill.sub_total), width)) text(row);
    for (const row of leftRight("Tax.Amt", amount(bill.tax_total), width)) text(row);
  }
  // Petbill's total is double width. It drops to normal width only if it wouldn't fit.
  const totalText = `Rs.${amount(bill.grand_total)}`;
  if (("TOTAL ".length + totalText.length) * 2 <= width) {
    text(`TOTAL ${totalText}`, { align: "right", bold: true, double: true });
  } else {
    for (const row of leftRight("TOTAL", totalText, width)) text(row, { bold: true });
  }
  rule();

  // Petbill prints the customer on credit bills only.
  if (settings.show_customer && bill.payment_type === "credit" && names.customerName) {
    for (const row of wrapText(names.customerName, width)) text(row);
  }
  const vehicle = settings.show_vehicle && bill.vehicle_no ? `VNO:${bill.vehicle_no}` : "";
  const cashier = settings.show_cashier && names.cashierName ? `Cashier:${names.cashierName}` : "";
  if (vehicle || cashier) for (const row of leftRight(vehicle, cashier, width)) text(row);
  if (settings.show_mileage) {
    for (const m of names.mileage) {
      if (m.mileage !== null) text(`MileAge :${amount(m.mileage)}`);
      if (m.odometer_prev !== null) {
        text(`KMR : ${amount(m.odometer_prev, 1)}-${amount(m.odometer_curr, 1)}=${amount(m.odometer_curr - m.odometer_prev, 1)}`);
      }
    }
  }
  if (settings.footer_text.trim()) {
    rule();
    for (const row of wrapText(settings.footer_text, width)) text(row, { align: "center" });
  }
  if (terminal.show_qr && opts.qrUrl) blocks.push({ kind: "qr", data: opts.qrUrl });

  return { width, blocks };
}

export function buildTestReceipt(settings: ReceiptSettings, terminal: TerminalPrinterSettings): ReceiptDocument {
  const width = terminal.chars_per_line;
  const blocks: ReceiptBlock[] = headerBlocks(settings, terminal);
  const left = (text: string) => blocks.push({ kind: "text", text, align: "left" });
  blocks.push({ kind: "rule" });
  blocks.push({ kind: "text", text: "TEST PRINT - NOT A BILL", align: "center", bold: true });
  blocks.push({ kind: "rule" });
  left("1234567890".repeat(Math.ceil(width / 10)).slice(0, width));
  left(`Paper ${terminal.paper_mm} mm, ${terminal.chars_per_line} characters`);
  left(`Encoding ${terminal.encoding}`);
  left(`Connection ${terminal.connection}`);
  blocks.push({ kind: "text", text: "Rs.1234.56", align: "right", bold: true, double: true });
  if (terminal.show_qr) blocks.push({ kind: "qr", data: "PETROPRO TEST PRINT" });
  blocks.push({ kind: "rule" });
  blocks.push({ kind: "text", text: "If this line is centred, alignment works", align: "center" });
  return { width, blocks };
}

/** What a reader sees on paper, for the preview screen and for tests. */
export function renderText(doc: ReceiptDocument): string {
  const out: string[] = [];
  for (const block of doc.blocks) {
    if (block.kind === "rule") out.push("-".repeat(doc.width));
    else if (block.kind === "logo") out.push("[logo]".padStart(Math.floor((doc.width + 6) / 2)));
    else if (block.kind === "qr") out.push("[QR code]".padStart(Math.floor((doc.width + 9) / 2)));
    else {
      const width = block.double ? Math.floor(doc.width / 2) : doc.width;
      const pad = block.align === "center" ? Math.max(0, Math.floor((width - block.text.length) / 2)) : block.align === "right" ? Math.max(0, width - block.text.length) : 0;
      out.push(" ".repeat(pad) + block.text);
    }
  }
  return out.join("\n");
}
