import type { MileageReport } from "@petropro/shared-types";

const money = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(v);

/** The summary band of Petbill's VWSMAGE and MCWS report forms. */
export function MileageTotals({ report }: { report: MileageReport }) {
  if (report.rows.length === 0) return null;
  const figures: [string, string][] = [
    ["No. of Bills", String(report.bill_count)],
    ["Total Qty", report.total_qty.toFixed(3)],
    ["Grand Total", money(report.total_amount)],
    ...(report.service_charge_percent > 0 ? ([[`Service Charge (${report.service_charge_percent}%)`, money(report.service_charge_amount)]] as [string, string][]) : []),
    ["Round up", money(report.round_off)],
    ["Net Amount", money(report.net_amount)],
  ];
  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="mileage-totals">
      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-6">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm italic text-fg-muted">{report.amount_in_words}</p>
    </div>
  );
}
