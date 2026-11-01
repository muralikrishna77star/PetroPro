import PDFDocument from "pdfkit";
import type { CustomerStatement } from "./customerStatement.js";

const MARGIN = 18;

/** Prints the statement's fixed-width text pages one-to-one onto A4 in Courier — a stand-in for
 *  the legacy continuous-stationery dot-matrix output: font size is picked so the form's full
 *  width (130 or 75 columns) fits the page, and each text page is one PDF page. */
export function generateCustomerStatementPdf(statement: CustomerStatement): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Courier's advance width is 0.6em.
    const usableWidth = 595.28 - MARGIN * 2;
    const usableHeight = 841.89 - MARGIN * 2;
    const fontSize = Math.min(11, usableWidth / (statement.width * 0.6));
    const lineHeight = usableHeight / statement.page_length;

    for (const page of statement.pages) {
      doc.addPage();
      doc.font("Courier").fontSize(fontSize);
      page.forEach((line, i) => {
        if (line) doc.text(line, MARGIN, MARGIN + i * lineHeight, { lineBreak: false });
      });
    }
    doc.end();
  });
}
