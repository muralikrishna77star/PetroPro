import ExcelJS from "exceljs";
import { reportsRepo, type Granularity } from "../repositories/reports.js";

/** VAT/GST summary as a real .xlsx workbook (master-prompt success criterion: PDF + Excel
 *  reports). One row per (period, tax rate) bucket, matching a typical GST return worksheet. */
export async function generateGstSummaryExcel(
  from: string,
  to: string,
  granularity: Granularity,
): Promise<Buffer> {
  const rows = reportsRepo.gstSummary(from, to, granularity);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("GST Summary");
  sheet.columns = [
    { header: "Period", key: "bucket", width: 14 },
    { header: "Tax %", key: "tax_percent", width: 10 },
    { header: "Taxable Value", key: "taxable_value", width: 16 },
    { header: "Tax Amount", key: "tax_amount", width: 14 },
    { header: "Total", key: "total", width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(row);
  }

  const totalTaxable = rows.reduce((sum, r) => sum + r.taxable_value, 0);
  const totalTax = rows.reduce((sum, r) => sum + r.tax_amount, 0);
  const totalAmount = rows.reduce((sum, r) => sum + r.total, 0);
  const totalsRow = sheet.addRow({
    bucket: "Total",
    tax_percent: "",
    taxable_value: totalTaxable,
    tax_amount: totalTax,
    total: totalAmount,
  });
  totalsRow.font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
