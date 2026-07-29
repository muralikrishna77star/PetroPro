"use client";

import { Fragment, useEffect, useState } from "react";
import {
  api,
  ApiError,
  downloadAuthed,
  type Granularity,
  type ItemSalesRow,
  type CashierSalesRow,
  type GroupItemSalesRow,
  type HsnSalesRow,
  type PurchaseGroupItemRow,
  type Bill,
  type VehicleSalesRow,
  type FleetCardSalesRow,
  type GstSummaryRow,
  type StockRow,
  type StockSummaryRow,
  type Purchase,
  type MileageEntry,
} from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";

type ReportType =
  | "sales-item"
  | "sales-cashier"
  | "sales-group"
  | "sales-hsn"
  | "bills"
  | "vehicles"
  | "fleet-cards"
  | "gst"
  | "stock-summary"
  | "stock"
  | "purchases"
  | "purchases-group"
  | "mileage";

const REPORT_LABELS: Record<ReportType, string> = {
  "sales-item": "Sales — Item-wise",
  "sales-cashier": "Sales — Cashier-wise",
  "sales-group": "Sales — Group-wise",
  "sales-hsn": "Sales — HSN-wise",
  bills: "Bill Register",
  vehicles: "Vehicle-wise Sales",
  "fleet-cards": "Fleet Card Sales",
  gst: "GST Summary",
  "stock-summary": "Stock Report — Group-wise",
  stock: "Stock Day-book",
  purchases: "Purchases",
  "purchases-group": "Purchases — Group-wise",
  mileage: "Vehicle Mileage",
};

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Day",
  week: "Weekly",
  month: "Monthly",
  quarter: "Quarterly",
  "half-year": "Half Yearly",
  year: "Yearly",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const session = useRequireSession(["super_admin", "owner"]);
  const [reportType, setReportType] = useState<ReportType>("sales-item");
  const [from, setFrom] = useState("2020-01-01");
  const [to, setTo] = useState(todayStr());
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [itemCode, setItemCode] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [rows, setRows] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Default "to" to the running billing date (docs: businessDateRepo) rather than the wall-clock
  // date — bills post against that date, so it's the last date data actually exists for.
  useEffect(() => {
    if (!session) return;
    api.getBusinessDate(session.token).then((r) => setTo(r.date)).catch(() => undefined);
  }, [session]);

  const needsGranularity =
    reportType.startsWith("sales-") ||
    reportType === "gst" ||
    reportType === "stock-summary" ||
    reportType === "purchases-group";
  const needsItemFilter = reportType === "stock" || reportType === "stock-summary" || reportType === "purchases";
  const needsVehicle = reportType === "mileage";

  async function runReport() {
    if (!session) return;
    setError(null);
    setLoading(true);
    try {
      switch (reportType) {
        case "sales-item":
          setRows(await api.getSalesReport(session.token, "item", from, to, granularity));
          break;
        case "sales-cashier":
          setRows(await api.getSalesReport(session.token, "cashier", from, to, granularity));
          break;
        case "sales-group":
          setRows(await api.getSalesReport(session.token, "group-items", from, to, granularity));
          break;
        case "sales-hsn":
          setRows(await api.getSalesReport(session.token, "hsn", from, to, granularity));
          break;
        case "purchases-group":
          setRows(await api.getPurchasesByGroup(session.token, from, to, granularity));
          break;
        case "bills":
          setRows(await api.getBillRegister(session.token, from, to));
          break;
        case "vehicles":
          setRows(await api.getVehicleSales(session.token, from, to));
          break;
        case "fleet-cards":
          setRows(await api.getFleetCardSales(session.token, from, to));
          break;
        case "gst":
          setRows(await api.getGstSummary(session.token, from, to, granularity));
          break;
        case "stock-summary":
          setRows(await api.getStockSummary(session.token, from, to, granularity, itemCode || undefined));
          break;
        case "stock":
          setRows(await api.getStockReport(session.token, from, to, itemCode || undefined));
          break;
        case "purchases":
          setRows(await api.getPurchaseReport(session.token, from, to, itemCode || undefined));
          break;
        case "mileage":
          if (!vehicleNo) {
            setError("Enter a vehicle number");
            setRows([]);
            return;
          }
          setRows(await api.getMileageReport(session.token, vehicleNo));
          break;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Report failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-semibold text-primary">Reports</h1>

        <Card color="violet" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Report</label>
            <select
              className="rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
              value={reportType}
              onChange={(e) => {
                setReportType(e.target.value as ReportType);
                setRows([]);
              }}
            >
              {Object.entries(REPORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {!needsVehicle && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">From</label>
                <input
                  type="date"
                  className="rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">To</label>
                <input
                  type="date"
                  className="rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </>
          )}

          {needsGranularity && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">Granularity</label>
              <select
                className="rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as Granularity)}
              >
                {Object.entries(GRANULARITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {needsItemFilter && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">Item code (optional)</label>
              <input
                className="rounded-lg border border-border px-3 py-1.5 text-sm uppercase  bg-bg-elevated"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
              />
            </div>
          )}

          {needsVehicle && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">Vehicle number</label>
              <input
                className="rounded-lg border border-border px-3 py-1.5 text-sm uppercase  bg-bg-elevated"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
              />
            </div>
          )}

          <button
            onClick={runReport}
            disabled={loading}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Running..." : "Run report"}
          </button>

          {reportType === "gst" && (
            <button
              onClick={() =>
                downloadAuthed(
                  api.gstExcelUrl(from, to, granularity),
                  session.token,
                  `gst-summary-${from}-to-${to}.xlsx`,
                )
              }
              className="rounded-lg border border-border px-3 py-1.5 text-sm "
            >
              Download Excel
            </button>
          )}
        </Card>

        {error && <p className="text-sm text-error">{error}</p>}

        <Card color="violet">
          <ReportTable reportType={reportType} rows={rows} />
        </Card>
      </div>
    </div>
  );
}

function ReportTable({ reportType, rows }: { reportType: ReportType; rows: unknown[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-fg-muted">No data. Choose a report and click &ldquo;Run report&rdquo;.</p>;
  }

  const money = (n: number) => `₹${n.toFixed(2)}`;

  switch (reportType) {
    case "sales-item": {
      const data = rows as ItemSalesRow[];
      return (
        <Table
          headers={["Period", "Item", "Qty", "Amount", "Tax"]}
          rows={data.map((r) => [r.bucket, `${r.item_name} (${r.item_code})`, r.qty, money(r.amount), money(r.tax_amount)])}
        />
      );
    }
    case "sales-cashier": {
      const data = rows as CashierSalesRow[];
      return (
        <Table
          headers={["Period", "Cashier", "Bills", "Amount"]}
          rows={data.map((r) => [r.bucket, `${r.cashier_name} (${r.user_id})`, r.bill_count, money(r.amount)])}
        />
      );
    }
    case "sales-group": {
      return (
        <GroupedTable
          rows={rows as GroupItemSalesRow[]}
          columns={[
            { header: "Qty", value: (r) => r.qty },
            { header: "Amount", value: (r) => r.amount, format: money },
            { header: "Tax", value: (r) => r.tax_amount, format: money },
          ]}
        />
      );
    }
    case "sales-hsn": {
      const data = rows as HsnSalesRow[];
      return (
        <Table
          headers={["Period", "HSN Code", "Qty", "Taxable value", "Tax", "Total"]}
          rows={data.map((r) => [
            r.bucket,
            r.hsn_code ?? "Not set",
            r.qty,
            money(r.taxable_value),
            money(r.tax_amount),
            money(r.total),
          ])}
        />
      );
    }
    case "purchases-group": {
      return (
        <GroupedTable
          rows={rows as PurchaseGroupItemRow[]}
          columns={[
            { header: "Qty", value: (r) => r.qty },
            { header: "Value", value: (r) => r.value, format: money },
          ]}
        />
      );
    }
    case "bills": {
      const data = rows as Bill[];
      return (
        <Table
          headers={["Bill #", "Date", "Vehicle", "Customer", "Total", "Status"]}
          rows={data.map((b) => [b.bill_no, b.bill_date, b.vehicle_no ?? "—", b.customer_code ?? "—", money(b.grand_total), b.status])}
        />
      );
    }
    case "vehicles": {
      const data = rows as VehicleSalesRow[];
      return (
        <Table
          headers={["Vehicle", "Bills", "Amount"]}
          rows={data.map((r) => [r.vehicle_no, r.bill_count, money(r.amount)])}
        />
      );
    }
    case "fleet-cards": {
      const data = rows as FleetCardSalesRow[];
      return (
        <Table
          headers={["Fleet card", "Bills", "Amount"]}
          rows={data.map((r) => [r.fleet_card, r.bill_count, money(r.amount)])}
        />
      );
    }
    case "gst": {
      const data = rows as GstSummaryRow[];
      return (
        <Table
          headers={["Period", "Tax %", "Taxable value", "Tax amount", "Total"]}
          rows={data.map((r) => [r.bucket, `${r.tax_percent}%`, money(r.taxable_value), money(r.tax_amount), money(r.total)])}
        />
      );
    }
    case "stock-summary": {
      return (
        <GroupedTable
          rows={rows as StockSummaryRow[]}
          columns={[
            { header: "Opening", value: (r) => r.opening },
            { header: "Purchases", value: (r) => r.purchases },
            { header: "Consumption", value: (r) => r.consumption },
            { header: "Closing", value: (r) => r.closing },
          ]}
        />
      );
    }
    case "stock": {
      const data = rows as StockRow[];
      return (
        <Table
          headers={["Item", "Date", "Opening", "Receipts", "Sales", "Closing", "Balance"]}
          rows={data.map((r) => [r.item_code, r.sdate, r.opening, r.receipts, r.sales, r.closing, r.balance])}
        />
      );
    }
    case "purchases": {
      const data = rows as Purchase[];
      return (
        <Table
          headers={["Date", "Item", "Qty", "Value", "Invoice"]}
          rows={data.map((r) => [r.pur_date, r.item_code, r.qty, money(r.value), r.invoice_no ?? "—"])}
        />
      );
    }
    case "mileage": {
      const data = rows as MileageEntry[];
      return (
        <Table
          headers={["Date", "Bill #", "Item", "Odometer prev", "Odometer curr", "Qty", "Mileage (km/unit)"]}
          rows={data.map((r) => [
            r.created_at,
            r.bill_no,
            r.item_code,
            r.odometer_prev ?? "—",
            r.odometer_curr,
            r.qty,
            r.mileage !== null ? r.mileage.toFixed(2) : "—",
          ])}
        />
      );
    }
  }
}

function Table({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border ">
            {headers.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border ">
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-4">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface GroupedRow {
  bucket: string;
  group_code: string | null;
  group_name: string | null;
  item_code: string;
  item_name: string;
}

interface GroupedColumn<T> {
  header: string;
  value: (row: T) => number;
  format?: (n: number) => string;
}

/** Shared shape for every "group subtotal + item rows beneath it" report (Sales, Purchases,
 *  Stock Summary — all group-wise views of an item-centric report): a bold group subtotal row
 *  (rolled up client-side from the same item rows the API already returns, so there's no second
 *  query) followed by its indented item rows, repeated per period bucket. `columns` supplies the
 *  numeric fields to sum/render — everything else (grouping, layout) is shared. */
function GroupedTable<T extends GroupedRow>({ rows, columns }: { rows: T[]; columns: GroupedColumn<T>[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-fg-muted">No data. Choose a report and click &ldquo;Run report&rdquo;.</p>;
  }

  const groups: { bucket: string; group_code: string | null; group_name: string | null; items: T[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.bucket === row.bucket && last.group_code === row.group_code) {
      last.items.push(row);
    } else {
      groups.push({ bucket: row.bucket, group_code: row.group_code, group_name: row.group_name, items: [row] });
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-4 font-medium">Period</th>
            <th className="py-2 pr-4 font-medium">Group / Item</th>
            {columns.map((c) => (
              <th key={c.header} className="py-2 pr-4 font-medium">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group, gi) => (
            <Fragment key={`${group.bucket}-${group.group_code}-${gi}`}>
              <tr className="border-b border-border bg-card-hover font-semibold">
                <td className="py-2 pr-4">{group.bucket}</td>
                <td className="py-2 pr-4">{group.group_name ?? group.group_code ?? "—"}</td>
                {columns.map((c) => {
                  const total = group.items.reduce((sum, r) => sum + c.value(r), 0);
                  return (
                    <td key={c.header} className="py-2 pr-4">
                      {c.format ? c.format(total) : total}
                    </td>
                  );
                })}
              </tr>
              {group.items.map((item, ii) => (
                <tr
                  key={`${group.bucket}-${group.group_code}-${item.item_code}-${ii}`}
                  className="border-b border-border text-fg-muted"
                >
                  <td className="py-1.5 pr-4" />
                  <td className="py-1.5 pr-4 pl-6">
                    {item.item_name} ({item.item_code})
                  </td>
                  {columns.map((c) => (
                    <td key={c.header} className="py-1.5 pr-4">
                      {c.format ? c.format(c.value(item)) : c.value(item)}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
