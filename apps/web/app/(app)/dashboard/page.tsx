"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  CloudSun,
  Gauge,
  Maximize2,
  Minimize2,
  Receipt,
  ShoppingCart,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  api,
  type AuditLog,
  type Bill,
  type Customer,
  type PendingTransaction,
  type Purchase,
  type Shift,
  type StockRow,
} from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { PlaceholderWidget } from "@/components/ui/PlaceholderWidget";

const LOW_STOCK_THRESHOLD = 10;
const TREND_DAYS = 7;
const LAST_SALES_COUNT = 5;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const session = useRequireSession(["super_admin", "owner"]);
  const [trendBills, setTrendBills] = useState<Bill[]>([]);
  const [pending, setPending] = useState<PendingTransaction[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [recentAudit, setRecentAudit] = useState<AuditLog[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [lastSales, setLastSales] = useState<Bill[]>([]);
  const [bigScreen, setBigScreen] = useState(false);

  useEffect(() => {
    if (!session) return;
    const today = todayStr();
    const weekAgo = daysAgoStr(TREND_DAYS - 1);
    api.getBillRegister(session.token, weekAgo, today).then(setTrendBills).catch(() => undefined);
    api.listPendingTransactions(session.token).then(setPending).catch(() => undefined);
    api.getStockReport(session.token, today, today).then(setStock).catch(() => undefined);
    api.listCustomers(session.token).then(setCustomers).catch(() => undefined);
    api.listAuditLogs(session.token).then((logs) => setRecentAudit(logs.slice(0, 8))).catch(() => undefined);
    api.listShifts(session.token).then(setShifts).catch(() => undefined);
    api.listPurchases(session.token).then(setPurchases).catch(() => undefined);
    api
      .getRecentBills(session.token, LAST_SALES_COUNT + 5)
      .then((bills) => setLastSales(bills.filter((b) => b.status !== "cancelled").slice(0, LAST_SALES_COUNT)))
      .catch(() => undefined);
  }, [session]);

  function toggleBigScreen() {
    if (!bigScreen) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
    }
    setBigScreen((v) => !v);
  }

  const today = todayStr();
  const activeBills = useMemo(() => trendBills.filter((b) => b.status !== "cancelled"), [trendBills]);
  const todaysBills = useMemo(() => activeBills.filter((b) => b.bill_date.slice(0, 10) === today), [activeBills, today]);
  const todaysTotal = todaysBills.reduce((sum, b) => sum + b.grand_total, 0);
  const lowStockItems = stock.filter((s) => s.balance < LOW_STOCK_THRESHOLD);
  const totalDue = customers.reduce((sum, c) => sum + c.due_amount, 0);
  const topDebtors = [...customers].sort((a, b) => b.due_amount - a.due_amount).slice(0, 5);

  const trendData = useMemo(() => {
    const byDay = new Map<string, number>();
    for (let i = TREND_DAYS - 1; i >= 0; i--) byDay.set(daysAgoStr(i), 0);
    for (const bill of activeBills) {
      const day = bill.bill_date.slice(0, 10);
      if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + bill.grand_total);
    }
    return [...byDay.entries()].map(([date, total]) => ({
      date: date.slice(5),
      total: Math.round(total),
    }));
  }, [activeBills]);

  const openShifts = shifts.filter((s) => s.status === "open");
  const recentPurchases = [...purchases]
    .sort((a, b) => b.pur_date.localeCompare(a.pur_date))
    .slice(0, 5);

  if (!session) return null;

  const cardSize = bigScreen ? "lg" : "md";

  return (
    <div className="flex flex-col gap-8 pb-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={`font-heading font-semibold text-fg ${bigScreen ? "text-4xl" : "text-2xl"}`}>
            Station Control Center
          </h1>
          <p className={`text-fg-muted ${bigScreen ? "text-lg" : "text-sm"}`}>Live overview for {today}</p>
        </div>
        <button
          type="button"
          onClick={toggleBigScreen}
          title="Enlarge for viewing from across the room — e.g. a lobby or office TV"
          className="flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-fg-muted hover:bg-card-hover"
        >
          {bigScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          {bigScreen ? "Exit big screen" : "Big screen"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Today's Sales" value={`₹${todaysTotal.toFixed(2)}`} icon={Wallet} color="primary" index={0} size={cardSize} />
        <MetricCard label="Bills today" value={String(todaysBills.length)} icon={Receipt} color="success" index={1} size={cardSize} />
        <MetricCard label="Pending queue" value={String(pending.length)} icon={Clock} color="warning" index={2} size={cardSize} />
        <MetricCard label="Customer dues" value={`₹${totalDue.toFixed(2)}`} icon={Users} color="secondary" index={3} size={cardSize} />
      </div>

      <Card color="zinc" className="overflow-x-auto">
        <h2 className={`mb-3 font-heading font-semibold text-fg ${bigScreen ? "text-2xl" : "text-lg"}`}>
          Last {LAST_SALES_COUNT} sales
        </h2>
        <table className={`w-full text-left ${bigScreen ? "text-lg" : "text-sm"}`}>
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-4">Bill #</th>
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Payment</th>
              <th className="py-2 pr-4">Customer / Vehicle</th>
              <th className="py-2 pr-4">Total</th>
            </tr>
          </thead>
          <tbody>
            {lastSales.map((b) => (
              <tr key={b.bill_no} className="border-b border-border">
                <td className="py-2 pr-4 font-mono">#{b.bill_no}</td>
                <td className="py-2 pr-4 text-fg-muted">{b.bill_date}</td>
                <td className="py-2 pr-4 capitalize">{b.payment_type}</td>
                <td className="py-2 pr-4">{b.customer_code ?? b.vehicle_no ?? "—"}</td>
                <td className="py-2 pr-4 font-mono">₹{b.grand_total.toFixed(2)}</td>
              </tr>
            ))}
            {lastSales.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-fg-muted">
                  No sales recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card color="zinc">
        <h2 className="mb-4 font-heading text-lg font-semibold text-fg">Sales trend — last {TREND_DAYS} days</h2>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData}>
              <XAxis dataKey="date" stroke="var(--pp-fg-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--pp-fg-muted)" fontSize={12} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{
                  background: "var(--pp-card)",
                  border: "1px solid var(--pp-border)",
                  borderRadius: 8,
                  color: "var(--pp-fg)",
                  fontSize: 12,
                }}
                formatter={(value) => [`₹${Number(value ?? 0).toFixed(2)}`, "Revenue"]}
              />
              <Bar dataKey="total" fill="var(--pp-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card color="amber">
          <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold text-fg">
            Low stock
            {lowStockItems.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-error/15 px-2 py-0.5 text-xs font-medium text-error">
                <AlertTriangle size={12} /> {lowStockItems.length}
              </span>
            )}
          </h2>
          {lowStockItems.length === 0 ? (
            <p className="text-sm text-fg-muted">All items above the {LOW_STOCK_THRESHOLD}-unit threshold.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {lowStockItems.map((s) => (
                <li key={s.item_code} className="rounded-lg bg-error/10 px-3 py-1.5 text-error">
                  {s.item_code}: balance {s.balance}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card color="violet">
          <h2 className="mb-3 font-heading text-lg font-semibold text-fg">Top customer dues</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {topDebtors.map((c) => (
              <li key={c.code} className="flex justify-between rounded-lg bg-card-hover px-3 py-1.5 text-fg">
                <span>
                  {c.name} ({c.code})
                </span>
                <span className="font-mono">₹{c.due_amount.toFixed(2)}</span>
              </li>
            ))}
            {topDebtors.length === 0 && <li className="text-fg-muted">No customers yet.</li>}
          </ul>
        </Card>

        <Card color="teal">
          <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold text-fg">
            <Clock size={16} /> Shift status
          </h2>
          <p className="mb-2 text-sm text-fg-muted">
            This app tracks cash-drawer shifts, not clock-in attendance — showing who currently has a shift open.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {openShifts.map((s) => (
              <li key={s.id} className="flex justify-between rounded-lg bg-card-hover px-3 py-1.5 text-fg">
                <span>{s.user_id}</span>
                <span className="font-mono text-fg-muted">opened {s.opened_at.slice(0, 16).replace("T", " ")}</span>
              </li>
            ))}
            {openShifts.length === 0 && <li className="text-fg-muted">No shifts currently open.</li>}
          </ul>
        </Card>

        <Card color="emerald">
          <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold text-fg">
            <ShoppingCart size={16} /> Recent purchases
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {recentPurchases.map((p) => (
              <li key={p.id} className="flex justify-between rounded-lg bg-card-hover px-3 py-1.5 text-fg">
                <span>
                  {p.item_code} × {p.qty}
                </span>
                <span className="font-mono text-fg-muted">
                  ₹{p.value.toFixed(2)} · {p.pur_date.slice(0, 10)}
                </span>
              </li>
            ))}
            {recentPurchases.length === 0 && <li className="text-fg-muted">No purchases recorded yet.</li>}
          </ul>
        </Card>

        <Card color="zinc" className="lg:col-span-2">
          <h2 className="mb-3 font-heading text-lg font-semibold text-fg">Recent activity</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {recentAudit.map((log) => (
              <li key={log.id} className="rounded-lg bg-card-hover px-3 py-1.5 text-fg">
                <span className="text-fg-muted">{log.created_at}</span> — {log.user_id ?? "system"}{" "}
                <span className="font-medium">{log.action}</span> {log.entity_type}
                {log.entity_id ? ` #${log.entity_id}` : ""}
              </li>
            ))}
            {recentAudit.length === 0 && <li className="text-fg-muted">No activity recorded yet.</li>}
          </ul>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 font-heading text-lg font-semibold text-fg">Not yet connected</h2>
        <p className="mb-4 text-sm text-fg-muted">
          These widgets need integrations this deployment doesn&apos;t have yet (tank sensors, pump
          telemetry, a weather API, and a forecasting model) — shown as placeholders rather than
          invented numbers.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PlaceholderWidget title="Live Pump Status" icon={Gauge} reason="No pump telemetry integration exists yet." />
          <PlaceholderWidget
            title="Tank Gauges"
            icon={Gauge}
            reason="Fill % needs a known tank capacity — not tracked in the schema."
          />
          <PlaceholderWidget title="Weather" icon={CloudSun} reason="No weather API is configured for this deployment." />
          <PlaceholderWidget title="AI Insights" icon={Sparkles} reason="No forecasting/anomaly-detection model is wired up." />
        </div>
      </div>
    </div>
  );
}
