import PDFDocument from "pdfkit";
import { billsRepo } from "../repositories/bills.js";
import { tenantsRepo } from "../repositories/tenants.js";
import { itemsRepo } from "../repositories/items.js";
import { amountInWords } from "./money.js";

/** The Item Name column sits between the code and Qty, which stay where they were. A name too long for
 *  it is shortened with "..." so every row keeps its single line. */
const NAME_X = 40;
const NAME_WIDTH = 86;

function fitWidth(doc: PDFKit.PDFDocument, text: string, width: number): string {
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 0 && doc.widthOfString(`${cut}...`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

/** Print-ready invoice PDF for a single bill (master-prompt success criterion: "Reports: PDF,
 *  Excel and print-ready invoices"). Deliberately simple/manual layout — pdfkit has no table
 *  primitive, and this doesn't need one for a handful of line items. */
export function generateInvoicePdf(billNo: number): Promise<Buffer> {
  const bill = billsRepo.get(billNo);
  if (!bill) throw new Error(`Bill ${billNo} not found`);
  const lines = billsRepo.getLines(billNo);
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
    if (company.tagline) doc.font("Helvetica-Oblique").text(company.tagline, { align: "center" });
    doc.font("Helvetica");
    doc.moveDown();

    if (bill.status === "cancelled") {
      doc.fontSize(12).font("Helvetica-Bold").fillColor("red").text("** CANCELLED **", { align: "center" });
      doc.fillColor("black").font("Helvetica");
    }

    doc.fontSize(11).text(`Invoice #${bill.bill_no}`, { continued: true }).text(`Date: ${bill.bill_date}`, {
      align: "right",
    });
    if (bill.vehicle_no) doc.text(`Vehicle: ${bill.vehicle_no}`);
    if (bill.customer_code) doc.text(`Customer: ${bill.customer_code}`);
    doc.text(`Payment: ${bill.payment_type}`);
    if (bill.order_no) doc.text(`Order No: ${bill.order_no}`);
    doc.moveDown(0.5);

    const startX = doc.page.margins.left;
    let y = doc.y;
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Item", startX, y);
    doc.text("Item Name", startX + NAME_X, y);
    doc.text("Qty", startX + 130, y);
    doc.text("Rate", startX + 175, y);
    doc.text("Tax", startX + 225, y);
    doc.text("Amount", startX + 270, y);
    y += 14;
    doc.moveTo(startX, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
    y += 4;

    doc.font("Helvetica");
    for (const line of lines) {
      doc.text(line.item_code, startX, y);
      doc.text(fitWidth(doc, itemsRepo.get(line.item_code)?.name ?? "", NAME_WIDTH), startX + NAME_X, y, { lineBreak: false });
      doc.text(line.qty.toString(), startX + 130, y);
      doc.text(line.rate.toFixed(2), startX + 175, y);
      doc.text(line.tax_amount.toFixed(2), startX + 225, y);
      doc.text(line.amount.toFixed(2), startX + 270, y);
      y += 14;
    }
    y += 4;
    doc.moveTo(startX, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
    y += 8;

    doc.font("Helvetica-Bold");
    doc.text(`Sub total: Rs ${bill.sub_total.toFixed(2)}`, startX, y);
    y += 14;
    doc.text(`Tax: Rs ${bill.tax_total.toFixed(2)}`, startX, y);
    y += 14;
    doc.fontSize(11).text(`Grand total: Rs ${bill.grand_total.toFixed(2)}`, startX, y);
    y += 20;

    doc.fontSize(9).font("Helvetica-Oblique").text(amountInWords(bill.grand_total), startX, y, {
      width: doc.page.width - startX - doc.page.margins.right,
    });

    doc.end();
  });
}
