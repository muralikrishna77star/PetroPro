import PDFDocument from "pdfkit";
import { receiptsRepo } from "../repositories/receipts.js";
import { customersRepo } from "../repositories/customers.js";
import { tenantsRepo } from "../repositories/tenants.js";
import { amountInWords } from "./money.js";

/** Print-ready receipt PDF for a single customer payment. Mirrors invoicePdf.ts's deliberately
 *  simple/manual layout (pdfkit has no table primitive, and a receipt has too few fields to need one). */
export function generateReceiptPdf(recNo: number): Promise<Buffer> {
  const receipt = receiptsRepo.get(recNo);
  if (!receipt) throw new Error(`Receipt ${recNo} not found`);
  const customer = customersRepo.get(receipt.customer_code);
  const company = tenantsRepo.get();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).font("Helvetica-Bold").text(company.name, { align: "center" });
    doc.fontSize(9).font("Helvetica");
    if (company.address_line1) doc.text(company.address_line1, { align: "center" });
    if (company.address_line2) doc.text(company.address_line2, { align: "center" });
    if (company.gst_no) doc.text(`GSTIN: ${company.gst_no}`, { align: "center" });
    doc.moveDown();

    doc.fontSize(12).font("Helvetica-Bold").text("RECEIPT", { align: "center" });
    doc.moveDown(0.5);

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(`Receipt #${receipt.rec_no}`, { continued: true })
      .text(`Date: ${receipt.rec_date}`, { align: "right" });
    doc.text(`Customer: ${customer ? `${customer.name} (${customer.code})` : receipt.customer_code}`);
    doc.text(`Mode: ${receipt.mode}`);
    if (receipt.cheque_no) doc.text(`Cheque No: ${receipt.cheque_no}`);
    if (receipt.bank_name) doc.text(`Bank: ${receipt.bank_name}`);
    doc.moveDown(0.5);

    doc.fontSize(13).font("Helvetica-Bold").text(`Amount received: Rs ${receipt.amount.toFixed(2)}`);
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .font("Helvetica-Oblique")
      .text(amountInWords(receipt.amount), { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });

    doc.end();
  });
}
