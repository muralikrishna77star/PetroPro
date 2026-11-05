"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { customerApi, ApiError, type CustomerReport } from "@/lib/api";
import { useRequireCustomerSession } from "@/lib/useCustomerSession";
import { clearCustomerSession } from "@/lib/customerAuth";
import { CustomerVehicleReports } from "@/components/CustomerVehicleReports";
import { Card } from "@/components/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// Guard spreadsheet formulas in text fields when opening the CSV in Excel.
const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  return `"${(typeof value === "string" && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
};

export default function CustomerReportsPage() {
  const session = useRequireCustomerSession();
  const router = useRouter();
  const [from, setFrom] = useState(() => today().slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<CustomerReport | null>(null);
  const [reportStyle, setReportStyle] = useState<"legacy" | "modern">("legacy");
  const [tab, setTab] = useState<"purchases" | "ledger" | "statement" | "mileage">("purchases");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function signOut() {
    clearCustomerSession();
    router.replace("/customer/login");
  }
  async function load() {
    if (!session) return;
    setReport(null);
    setError(null);
    if (!from || !to || from > to) { setError("Choose valid dates with From on or before To."); return; }
    setLoading(true);
    try { const [result, profile] = await Promise.all([customerApi.getReport(session.token, from, to), customerApi.me(session.token)]); setReport(result); setReportStyle(profile.report_style); }
    catch (err) {
      if (err instanceof ApiError && err.status === 401) { signOut(); return; }
      setError(err instanceof Error ? err.message : "Unable to fetch reports. Please try again.");
    } finally { setLoading(false); }
  }
  useEffect(() => {
    // Fetch the external account report once the stored customer identity becomes available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (session) void load();
    // Initial load only; subsequent date changes are applied with View report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function download() {
    if (!report) return;
    const rows: unknown[][] = [
      ["PetroPro", report.customer.name, report.from, report.to],
      ...(tab === "purchases" ? [
        ["Date", "Bill", "Vehicle", "Payment type", "Amount"],
        ...report.purchases.map(p => [p.bill_date, p.bill_no, p.vehicle_no, p.payment_type, p.grand_total]),
      ] : [
        ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
        ...report.ledger.map(e => [e.date, e.ref, e.description, e.debit, e.credit, e.balance]),
      ]),
    ];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(r => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `my-${tab}-${report.from}-${report.to}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!session) return null;
  return (
    <main className="customer-reports mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 print:bg-white print:text-black">
      <style>{`@media print {
        .customer-reports { --pp-card: white; --pp-fg: black; --pp-fg-muted: #444; --pp-border: #ccc; }
        .customer-reports table { font-size: 10pt; }
        .customer-reports tr { break-inside: avoid; }
        .customer-reports thead { display: table-header-group; }
      }`}</style>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-medium text-primary">PetroPro · Customer Portal</p><h1 className="text-2xl font-semibold">My reports</h1><p className="text-sm text-fg-muted">{session.name}</p></div>
        <nav aria-label="Customer navigation" className="flex items-center gap-4 print:hidden"><Link href="/customer/orders" className="text-sm text-primary hover:underline">My orders</Link><Button variant="outline" onClick={signOut}>Sign out</Button></nav>
      </header>
      <Card color="violet" className="print:hidden">
        <form onSubmit={e => { e.preventDefault(); void load(); }} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">From<Input type="date" value={from} onChange={e => setFrom(e.target.value)} required disabled={loading} /></label>
          <label className="text-sm">To<Input type="date" value={to} onChange={e => setTo(e.target.value)} required disabled={loading} /></label>
          <Button type="submit" disabled={loading}>{loading ? "Loading…" : "View report"}</Button>
        </form>
        <p className="mt-3 text-xs text-fg-muted">Reports include transactions recorded against your registered customer account.</p>
      </Card>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      {loading && <p role="status">Fetching your report…</p>}
      {report && <>
        <p className="text-sm text-fg-muted">Reporting format: {reportStyle === "legacy" ? "Legacy" : "Modern"} · Report period: {report.from} to {report.to}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["Purchases in period", report.purchases.reduce((s, p) => s + p.grand_total, 0)], ["Credit opening balance", report.opening_balance], ["Payments in period", report.ledger.reduce((s, e) => s + e.credit, 0)], ["Credit closing balance", report.closing_balance]].map(([label, value]) => <Card key={label} color="emerald"><p className="text-xs text-fg-muted">{label}</p><p className="mt-1 text-xl font-semibold">{money(Number(value))}</p></Card>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex flex-wrap gap-2" aria-label="Report type">
            <Button variant={tab === "purchases" ? "primary" : "outline"} onClick={() => setTab("purchases")}>Purchase history</Button>
            <Button variant={tab === "ledger" ? "primary" : "outline"} onClick={() => setTab("ledger")}>Account ledger</Button>
            <Button variant={tab === "statement" ? "primary" : "outline"} onClick={() => setTab("statement")}>Credit sales statement</Button>
            <Button variant={tab === "mileage" ? "primary" : "outline"} onClick={() => setTab("mileage")}>Vehicle mileage</Button>
          </div>
          {(tab === "purchases" || tab === "ledger") && <div className="flex gap-2"><Button variant="outline" onClick={download}>Download CSV</Button><Button variant="outline" onClick={() => window.print()}>Print / Save PDF</Button></div>}
        </div>
        {(tab === "statement" || tab === "mileage") ? <CustomerVehicleReports reportStyle={reportStyle} key={`${tab}-${report.from}-${report.to}`} token={session.token} from={report.from} to={report.to} mode={tab} /> : <Card color="violet">
          <h2 className="mb-3 text-lg font-semibold">{tab === "purchases" ? "Purchase history" : "Account ledger"}</h2>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead><tr className="border-b border-border">{(tab === "purchases" ? ["Date", "Bill", "Vehicle", "Payment", "Amount"] : ["Date", "Description", "Debit", "Credit", "Balance"]).map(h => <th key={h} scope="col" className="whitespace-nowrap p-2">{h}</th>)}</tr></thead>
            <tbody>{tab === "purchases" ? report.purchases.map(p => <tr key={p.bill_no} className="border-b border-border"><td className="p-2 whitespace-nowrap">{p.bill_date.slice(0, 10)}</td><td className="p-2">#{p.bill_no}</td><td className="p-2">{p.vehicle_no || "—"}</td><td className="p-2">{p.payment_type}</td><td className="p-2 whitespace-nowrap">{money(p.grand_total)}</td></tr>) : report.ledger.map((e, i) => <tr key={i} className="border-b border-border"><td className="p-2 whitespace-nowrap">{e.date.slice(0, 10)}</td><td className="p-2">{e.description}</td><td className="p-2 whitespace-nowrap">{money(e.debit)}</td><td className="p-2 whitespace-nowrap">{money(e.credit)}</td><td className="p-2 whitespace-nowrap">{money(e.balance)}</td></tr>)}</tbody>
          </table></div>
          {tab === "purchases" && !report.purchases.length && <p className="py-6 text-center text-sm text-fg-muted">No purchases in this period.</p>}
          {tab === "ledger" && <p className="mt-3 text-xs text-fg-muted">Credit bills and receipts only. Cash and digital purchases appear in Purchase history.</p>}
        </Card>}
      </>}
    </main>
  );
}
