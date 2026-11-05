"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { api, customerApi, ApiError, downloadAuthed, type CustomerStatement, type CustomerStatementQuery, type MileageEntry } from "@/lib/api";
import { clearCustomerSession } from "@/lib/customerAuth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const money = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(v);
type Mileage = MileageEntry & { bill_date: string; item_name: string };
const cell = (v: unknown) => { const s = String(v ?? ""); return `"${(typeof v === "string" && /^\s*[=+\-@]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`; };

export function CustomerVehicleReports({ token, from, to, mode, customerCode, initialVehicle = "", reportStyle = "modern" }: { token: string; from: string; to: string; mode: "statement" | "mileage"; customerCode?: string; initialVehicle?: string; reportStyle?: "legacy" | "modern" }) {
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [group, setGroup] = useState(true);
  const [opening, setOpening] = useState(true);
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [mileage, setMileage] = useState<Mileage[] | null>(null);
  const [applied, setApplied] = useState<CustomerStatementQuery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  function fail(err: unknown) {
    if (!customerCode && err instanceof ApiError && err.status === 401) {
      clearCustomerSession(); window.location.assign("/customer/login"); return;
    }
    setError(err instanceof Error ? err.message : "Could not fetch your report. Please try again.");
  }
  async function load(query: CustomerStatementQuery) {
    const id = ++sequence.current;
    setBusy(true); setError(null); setStatement(null); setMileage(null); setApplied(null);
    try {
      if (mode === "statement") {
        const result = await customerApi.getStatement(token, query);
        if (id === sequence.current) setStatement(result);
      } else {
        const result = await (customerCode ? api.getCustomerMileage(token, customerCode, query) : customerApi.getMileage(token, query));
        if (id === sequence.current) setMileage(result.rows);
      }
      if (id === sequence.current) setApplied(query);
    } catch (err) { if (id === sequence.current) fail(err); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    // Fetch once when the user opens this report; filters are applied by its form.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ from, to, vehicleNo: initialVehicle || undefined, groupByVehicle: true, withOpening: true });
    // This is a request generation counter, not a DOM ref; invalidate the latest pending response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { sequence.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, from, to, mode, customerCode, initialVehicle]);

  const groups: { vehicle: string; lines: CustomerStatement["lines"] }[] = [];
  if (statement) {
    for (const line of statement.lines) {
      const key = applied?.groupByVehicle ? line.vehicle_no || "No vehicle recorded" : "All vehicles";
      const last = groups.at(-1);
      if (last?.vehicle === key) last.lines.push(line);
      else groups.push({ vehicle: key, lines: [line] });
    }
  }
  function csv() {
    const rows: unknown[][] = [[mode === "statement" ? "Credit sales statement" : "Vehicle mileage", from, to, applied?.vehicleNo || "All vehicles"]];
    if (statement) {
      rows.push(["Date", "Bill", "Order", "Vehicle", "Item", "Quantity", "Rate", "Amount"]);
      for (const g of groups) {
        for (const l of g.lines) rows.push([l.bill_date, l.bill_no, l.order_no, l.vehicle_no, l.item_name, l.qty, l.rate, l.amount]);
        if (applied?.groupByVehicle) rows.push(["Vehicle subtotal", "", "", g.vehicle, "", "", "", g.lines.reduce((s, l) => s + l.amount, 0)]);
      }
      rows.push(["Sales total", statement.total_amount], ["Service charge", statement.service_charge_amount]);
      if (applied?.withOpening) rows.push(["Account opening balance", statement.opening_balance], ["Account receipts", statement.receipts]);
      rows.push(["Net amount", statement.net_amount]);
    } else if (mileage) {
      rows.push(["Date", "Vehicle", "Bill", "Item", "Odometer previous", "Odometer current", "Quantity", "Mileage (km/unit)"]);
      mileage.forEach(m => rows.push([m.bill_date, m.vehicle_no, m.bill_no, m.item_name, m.odometer_prev, m.odometer_curr, m.qty, m.mileage]));
    }
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `my-${mode}-${from}-${to}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function pdf() {
    if (!applied) return;
    try { await downloadAuthed(customerApi.statementPdfUrl(applied), token, `my-credit-statement-${from}-${to}.pdf`); }
    catch (err) { fail(err); }
  }
  const headers = statement ? ["Date", "Bill", "Order", "Vehicle", "Item", "Quantity", "Rate", "Amount"] : ["Date", "Vehicle", "Bill", "Item", "Previous km", "Current km", "Quantity", "Mileage km/unit"];
  return <section className="rounded-2xl border border-border bg-card p-5">
    <h2 className="text-lg font-semibold">{mode === "statement" ? "Credit sales statement" : (customerCode ? "Credit vehicle mileage statement" : "Vehicle mileage report")}</h2>
    <form className="my-4 flex flex-wrap items-end gap-4 print:hidden" onSubmit={e => { e.preventDefault(); void load({ from, to, vehicleNo: vehicle.trim() || undefined, groupByVehicle: group, withOpening: opening }); }}>
      <label className="text-sm">{mode === "statement" ? "Vehicle number / prefix (optional)" : "Vehicle number (optional)"}<Input value={vehicle} onChange={e => setVehicle(e.target.value)} maxLength={100} placeholder="All vehicles" disabled={busy} /></label>
      {mode === "statement" && <>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={group} onChange={e => setGroup(e.target.checked)} disabled={busy} />Group by vehicle</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={opening} onChange={e => setOpening(e.target.checked)} disabled={busy} />Include opening / closing balances</label>
      </>}
      <Button disabled={busy}>{busy ? "Loading…" : "Apply options"}</Button>
    </form>
    {error && <p role="alert" className="my-3 text-sm text-error">{error}</p>}
    {busy && <p role="status" className="my-3 text-sm">Loading your report…</p>}
    {applied && <>
      <p className="my-3 text-sm text-fg-muted">{from} to {to} · Vehicle: {applied.vehicleNo || "All vehicles"}</p>
      <div className="mb-4 flex flex-wrap gap-2 print:hidden"><Button variant="outline" onClick={csv}>Download CSV</Button>{statement && <Button variant="outline" onClick={() => void pdf()}>Download statement PDF</Button>}<Button variant="outline" onClick={() => window.print()}>Print / Save PDF</Button></div>
      {reportStyle === "legacy" && statement ? <div className="overflow-x-auto rounded-lg border border-border p-3"><p className="mb-2 text-xs text-fg-muted">Legacy FoxPro statement layout</p>{statement.pages.map((page, index) => <pre key={index} className="mb-5 w-max whitespace-pre font-mono text-xs leading-5">{page.join("\n")}</pre>)}</div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr>{headers.map(h => <th className="whitespace-nowrap border-b border-border p-2" scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{statement ? groups.map((g, index) => <Fragment key={index}>
          {applied.groupByVehicle && <tr className="bg-bg-elevated font-semibold"><th colSpan={8} scope="rowgroup" className="p-2">{g.vehicle}</th></tr>}
          {g.lines.map((l, i) => <tr key={i}>{[l.bill_date, l.bill_no, l.order_no || "—", l.vehicle_no || "—", l.item_name, l.qty.toFixed(3), money(l.rate), money(l.amount)].map((v, j) => <td className="whitespace-nowrap border-b border-border p-2" key={j}>{v}</td>)}</tr>)}
          {applied.groupByVehicle && <tr className="font-semibold"><td colSpan={7} className="p-2">Vehicle subtotal — {g.vehicle}</td><td className="p-2">{money(g.lines.reduce((s, l) => s + l.amount, 0))}</td></tr>}
        </Fragment>) : mileage?.map(m => <tr key={m.id}>{[m.bill_date, m.vehicle_no, m.bill_no, m.item_name, m.odometer_prev ?? "—", m.odometer_curr, m.qty.toFixed(3), m.mileage === null ? "—" : m.mileage.toFixed(2)].map((v, j) => <td className="whitespace-nowrap border-b border-border p-2" key={j}>{v}</td>)}</tr>)}</tbody>
      </table></div>}
      {((statement && !statement.lines.length) || (mileage && !mileage.length)) && <p className="py-5 text-center text-sm text-fg-muted">No records for this period and vehicle.</p>}
      {statement && <>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          {[["Sales total", statement.total_amount], ["Service charge", statement.service_charge_amount], ...(applied.withOpening ? [["Account opening balance", statement.opening_balance], ["Account receipts", statement.receipts]] : []), ["Round off", statement.round_off], [applied.withOpening ? "Closing amount" : "Net sales amount", statement.net_amount]].map(([label, amount]) => <div key={label}><p className="text-fg-muted">{label}</p><p className="font-semibold">{money(Number(amount))}</p></div>)}
        </div>
        <p className="mt-3 text-xs text-fg-muted">Credit sales only. Opening balances and receipts apply to the whole customer account, including when sales are filtered by vehicle. Use Account ledger for the full account closing balance.</p>
      </>}
      {mileage && <p className="mt-3 text-xs text-fg-muted">{customerCode ? "Credit bills only. " : ""}Mileage uses the odometer readings recorded against your bills. A dash means a previous reading or mileage was not recorded.</p>}
    </>}
  </section>;
}
