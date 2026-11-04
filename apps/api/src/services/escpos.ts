import type { PrinterEncoding, ReceiptDocument, ReceiptLogo, TerminalPrinterSettings } from "@petropro/shared-types";

/** Standard ESC/POS commands, as Epson documents them and compatible printers implement them. */
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CP437_UPPER =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/** The ESC t page number for each encoding. "ascii" leaves the printer's default page alone. */
const CODE_PAGES: Record<PrinterEncoding, number | null> = { ascii: null, cp437: 0, cp858: 19 };

function upperTable(encoding: PrinterEncoding): Map<string, number> {
  const table = new Map<string, number>();
  if (encoding === "ascii") return table;
  [...CP437_UPPER].forEach((ch, i) => table.set(ch, 0x80 + i));
  // CP858 is CP437's Western sibling with the euro sign, and differs in more than that one place,
  // but these are the characters a receipt can realistically hold.
  if (encoding === "cp858") table.set("€", 0xd5);
  return table;
}

/** Thermal printers have no rupee sign on these pages, so it's spelled out as Petbill did. Anything
 *  else with no equivalent prints as "?" rather than as a random character from the printer's page. */
export function encodeText(text: string, encoding: PrinterEncoding): Buffer {
  const table = upperTable(encoding);
  const bytes: number[] = [];
  for (const ch of text.replace(/₹/g, "Rs.")) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) bytes.push(code);
    else bytes.push(table.get(ch) ?? 0x3f);
  }
  return Buffer.from(bytes);
}

function qrCommands(data: string, encoding: PrinterEncoding): Buffer {
  const payload = encodeText(data, encoding);
  const store = payload.length + 3;
  return Buffer.concat([
    Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]), // model 2
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]), // module size
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]), // error correction M
    Buffer.from([GS, 0x28, 0x6b, store & 0xff, store >> 8, 0x31, 0x50, 0x30]),
    payload,
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]), // print
    Buffer.from([LF]),
  ]);
}

function logoCommands(logo: ReceiptLogo): Buffer {
  const bytesWide = Math.ceil(logo.width / 8);
  return Buffer.concat([
    Buffer.from([GS, 0x76, 0x30, 0x00, bytesWide & 0xff, bytesWide >> 8, logo.height & 0xff, logo.height >> 8]),
    Buffer.from(logo.raster_base64, "base64"),
    Buffer.from([LF]),
  ]);
}

export function renderEscPos(doc: ReceiptDocument, terminal: TerminalPrinterSettings, logo: ReceiptLogo | null): Buffer {
  const parts: Buffer[] = [Buffer.from([ESC, 0x40])]; // initialise
  const page = CODE_PAGES[terminal.encoding];
  if (page !== null) parts.push(Buffer.from([ESC, 0x74, page]));

  const align = (a: "left" | "center" | "right") => Buffer.from([ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0]);
  for (const block of doc.blocks) {
    if (block.kind === "rule") {
      parts.push(align("left"), encodeText("-".repeat(doc.width), terminal.encoding), Buffer.from([LF]));
    } else if (block.kind === "logo") {
      if (logo) parts.push(align("center"), logoCommands(logo));
    } else if (block.kind === "qr") {
      parts.push(align("center"), qrCommands(block.data, terminal.encoding));
    } else {
      parts.push(
        align(block.align),
        Buffer.from([ESC, 0x45, block.bold ? 1 : 0]),
        Buffer.from([GS, 0x21, block.double ? 0x11 : 0x00]),
        encodeText(block.text, terminal.encoding),
        Buffer.from([LF]),
      );
    }
  }
  parts.push(Buffer.from([ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0]));

  // Enough paper to clear the cutter, or to tear off by hand.
  parts.push(Buffer.from([ESC, 0x64, 4]));
  if (terminal.auto_cut) parts.push(Buffer.from([GS, 0x56, 0x42, 0x00]));
  return Buffer.concat(parts);
}

export function renderCopies(doc: ReceiptDocument, terminal: TerminalPrinterSettings, logo: ReceiptLogo | null, copies: number): Buffer {
  const one = renderEscPos(doc, terminal, logo);
  return Buffer.concat(Array.from({ length: Math.max(1, copies) }, () => one));
}
