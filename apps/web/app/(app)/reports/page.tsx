"use client";

import { useState } from "react";
import {
  api,
  ApiError,
  downloadAuthed,
  type Granularity,
  type ItemSalesRow,
  type CashierSalesRow,
  type GroupSalesRow,
  type Bill,
  type VehicleSalesRow,
  type FleetCardSalesRow,
  type GstSummaryRow,
  type StockRow,
  type Purchase,
  type MileageEntry,
} from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";

type ReportType =
  | "sales-item"
  | "sales-cashier"
  | "sales-group"
  | "bills"
  | "vehicles"
  | "fleet-cards"
  | "gst"
  | "stock"
  | "purchases"
  | "mileage";

const REPORT_LABELS: Record<ReportType, string> = {
  "sales-item": "Sales — Item-wise",
  "sales-cashier": "Sales — Cashier-wise",
  "sales-group": "Sales — Group-wise",
  bills: "Bill Register",
  vehicles: "Vehicle-wise Sales",
  "fleet-cards": "Fleet Card Sales",
  gst: "GST Summary",
  stock: "Stock Day-book",
  purchases: "Purchases",
  mileage: "Vehicle Mileage",
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

  const needsGranularity = reportType.startsWith("sales-") || reportType === "gst";
  const needsItemFilter = reportType === "stock" || reportType === "purchases";
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
          setRows(await api.getSalesReport(session.token, "group", from, to, granularity));
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
                <option value="day">Day</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
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
      const data = rows as GroupSalesRow[];
      return (
        <Table
          headers={["Period", "Group", "Qty", "Amount", "Tax"]}
          rows={data.map((r) => [r.bucket, r.group_name ?? r.group_code ?? "—", r.qty, money(r.amount), money(r.tax_amount)])}
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
