import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { ReceiptDocument, ReceiptSettings, TerminalPrinterSettings } from "@petropro/shared-types";

const MM = 72 / 25.4;
const QR_SIZE_MM = 30;
const LOGO_WIDTH_MM = 40;

/** The thermal receipt as a PDF of the same width and exactly its own length, so it prints the same
 *  from any device. Courier's 0.6 em advance is what lets the character columns line up. */
export async function renderReceiptPdf(doc: ReceiptDocument, terminal: TerminalPrinterSettings, settings: ReceiptSettings): Promise<Buffer> {
  const pageWidth = terminal.paper_mm * MM;
  const printable = Math.min(terminal.printable_mm, terminal.paper_mm) * MM;
  const margin = (pageWidth - printable) / 2;
  const fontSize = printable / doc.width / 0.6;
  const lineHeight = fontSize * 1.25;
  const logo = settings.logo && terminal.show_logo ? settings.logo : null;
  const logoHeight = logo ? ((LOGO_WIDTH_MM * MM) / logo.width) * logo.height : 0;

  let height = margin * 2;
  for (const block of doc.blocks) {
    if (block.kind === "logo") height += logoHeight + lineHeight / 2;
    else if (block.kind === "qr") height += QR_SIZE_MM * MM + lineHeight;
    else height += block.kind === "text" && block.double ? lineHeight * 2 : lineHeight;
  }

  const qrImages = new Map<string, Buffer>();
  for (const block of doc.blocks) {
    if (block.kind === "qr") qrImages.set(block.data, await QRCode.toBuffer(block.data, { margin: 1, width: 300 }));
  }

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: [pageWidth, height], margin: 0 });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    let y = margin;
    const textOptions = { width: printable, lineBreak: false } as const;
    for (const block of doc.blocks) {
      if (block.kind === "rule") {
        pdf.font("Courier").fontSize(fontSize).text("-".repeat(doc.width), margin, y, textOptions);
        y += lineHeight;
      } else if (block.kind === "logo") {
        if (logo) {
          const data = Buffer.from(logo.preview_data_url.split(",")[1], "base64");
          pdf.image(data, (pageWidth - LOGO_WIDTH_MM * MM) / 2, y, { width: LOGO_WIDTH_MM * MM });
          y += logoHeight + lineHeight / 2;
        }
      } else if (block.kind === "qr") {
        const size = QR_SIZE_MM * MM;
        pdf.image(qrImages.get(block.data)!, (pageWidth - size) / 2, y + lineHeight / 2, { width: size });
        y += size + lineHeight;
      } else {
        pdf
          .font(block.bold ? "Courier-Bold" : "Courier")
          .fontSize(block.double ? fontSize * 2 : fontSize)
          .text(block.text, margin, y, { ...textOptions, align: block.align });
        y += block.double ? lineHeight * 2 : lineHeight;
      }
    }
    pdf.end();
  });
}
