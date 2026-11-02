"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Boxes, ClipboardCheck, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { ApiError, techApi, type TechDashboard, type TechService } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MetricCard } from "@/components/ui/MetricCard";
import { Select } from "@/components/ui/Select";
import { AlertRow, ServicePanel } from "./ServicePanel";
import {
  BILLING,
  CATEGORY_LABEL,
  COST_MODEL,
  FREQUENCY,
  SUBSCRIPTION,
  dataSources,
  fmtDate,
  fmtMoney,
  fmtTimestamp,
  subscriptionState,
} from "./labels";

/** Filter values beyond the status enums, for services with no record to read a status from. */
const NOT_CONFIGURED = "not_configured";
const NO_SUBSCRIPTION = "no_subscription";

function subscriptionFilterValue(s: TechService): string {
  return s.subscription?.subscription_status ?? (s.can_record ? NOT_CONFIGURED : NO_SUBSCRIPTION);
}

function billingFilterValue(s: TechService): string {
  return s.subscription?.billing_status ?? (s.can_record ? NOT_CONFIGURED : NO_SUBSCRIPTION);
}

function PlanCell({ service }: { service: TechService }) {
  const check = service.provider_check;
  const sub = service.subscription;
  if (!service.can_record) return <span className="text-fg-muted">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {check?.ok && check.plan ? (
        <span className="text-fg">
          {check.plan} <span className="text-xs text-success">verified</span>
        </span>
      ) : sub?.plan ? (
        <span className="text-fg">
          {sub.plan} <span className="text-xs text-fg-muted">manual</span>
        </span>
      ) : (
        <span className="text-fg-muted">Unknown</span>
      )}
      {sub?.account_owner && <span className="break-all text-xs text-fg-muted">{sub.account_owner}</span>}
    </div>
  );
}

function CostCell({ service }: { service: TechService }) {
  const sub = service.subscription;
  if (!service.can_record) return <span className="text-fg-muted">—</span>;
  if (!sub) return <span className="text-fg-muted">Not configured</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-fg">
        {sub.amount !== null && sub.currency ? fmtMoney(sub.amount, sub.currency) : "Unknown"}
      </span>
      <span className="text-xs text-fg-muted">{FREQUENCY[sub.billing_frequency]}</span>
    </div>
  );
}

function DatesCell({ service }: { service: TechService }) {
  const sub = service.subscription;
  if (!service.can_record) return <span className="text-fg-muted">—</span>;
  if (!sub) return <span className="text-fg-muted">Not configured</span>;
  return (
    <div className="flex flex-col gap-0.5 text-xs text-fg-muted">
      <span>Payment: {sub.next_payment_date ? fmtDate(sub.next_payment_date) : "Unknown"}</span>
      <span>Renews: {sub.renewal_date ? fmtDate(sub.renewal_date) : "Unknown"}</span>
      <span>Auto-renew: {{ yes: "Yes", no: "No", unknown: "Unknown" }[sub.auto_renew]}</span>
    </div>
  );
}

function SourceCell({ service }: { service: TechService }) {
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {dataSources(service).map((d) => (
        <li key={d.label} className={d.tone === "verified" ? "text-success" : d.tone === "failed" ? "text-error" : "text-fg-muted"}>
          {d.label}
          {d.date && <span className="text-fg-muted"> · {fmtDate(d.date)}</span>}
        </li>
      ))}
    </ul>
  );
}

function BillingBadge({ service }: { service: TechService }) {
  if (!service.can_record) return <span className="text-fg-muted">—</span>;
  if (!service.subscription) return <Badge className="whitespace-nowrap">Not configured</Badge>;
  const b = BILLING[service.subscription.billing_status];
  return (
    <Badge variant={b.variant} className="whitespace-nowrap">
      {b.label}
    </Badge>
  );
}

export default function TechnologyPage() {
  const session = useRequireSession(["super_admin"]);
  const [data, setData] = useState<TechDashboard | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; status: number | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [costModel, setCostModel] = useState("");
  const [subscription, setSubscription] = useState("");
  const [billing, setBilling] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);

  const load = useCallback(
    (token: string) =>
      techApi
        .getDashboard(token)
        .then((dashboard) => {
          setData(dashboard);
          setLoadError(null);
        })
        .catch((err: unknown) => {
          setLoadError(
            err instanceof ApiError
              ? { message: err.message, status: err.status }
              : { message: "The API could not be reached.", status: null },
          );
        }),
    [],
  );

  useEffect(() => {
    if (session) void load(session.token);
  }, [session, load]);

  const attention = useMemo(
    () => new Set((data?.alerts ?? []).filter((a) => a.severity !== "info").map((a) => a.service_id)),
    [data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.services ?? []).filter((s) => {
      if (category && s.category !== category) return false;
      if (costModel && s.cost_model !== costModel) return false;
      if (subscription && subscriptionFilterValue(s) !== subscription) return false;
      if (billing && billingFilterValue(s) !== billing) return false;
      if (attentionOnly && !attention.has(s.id)) return false;
      if (!q) return true;
      return [s.name, s.provider, s.purpose, s.subscription?.plan, s.subscription?.account_owner, ...s.used_in]
        .some((text) => text?.toLowerCase().includes(q));
    });
  }, [data, query, category, costModel, subscription, billing, attentionOnly, attention]);

  if (!session) return null;

  async function refresh() {
    setRefreshing(true);
    await load(session!.token);
    setRefreshing(false);
  }

  async function checkAll(services: TechService[]) {
    setCheckingAll(true);
    await Promise.allSettled(services.map((s) => techApi.verify(session!.token, s.id)));
    await load(session!.token);
    setCheckingAll(false);
  }

  function clearFilters() {
    setQuery("");
    setCategory("");
    setCostModel("");
    setSubscription("");
    setBilling("");
    setAttentionOnly(false);
  }

  const heading = (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-fg">Technology &amp; Subscriptions</h1>
      <p className="text-sm text-fg-muted">What PetroPro runs on, and what&apos;s recorded about paying for it.</p>
    </div>
  );

  if (!data) {
    if (loadError) {
      return (
        <div className="flex flex-col gap-6 pb-8">
          {heading}
          <Card color="error" className="flex flex-col items-start gap-3">
            <p className="font-semibold text-fg">
              {loadError.status === 401
                ? "Your session has expired"
                : loadError.status === 403
                  ? "Only Super Admins can open this dashboard"
                  : "The dashboard is unavailable"}
            </p>
            <p className="text-sm text-fg-muted">{loadError.message}</p>
            {loadError.status === 401 ? (
              <Link href="/login" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                Sign in again
              </Link>
            ) : loadError.status !== 403 ? (
              <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                {refreshing ? "Retrying…" : "Try again"}
              </Button>
            ) : null}
          </Card>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6 pb-8" aria-busy="true" aria-label="Loading the dashboard">
        {heading}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-card" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-2xl border border-border bg-card" />
      </div>
    );
  }

  const { services, alerts, costs } = data;
  const managed = services.filter((s) => s.cost_model === "managed_service" && s.can_record);
  const recorded = managed.filter((s) => s.subscription).length;
  const noBill = services.filter((s) => ["open_source", "built_in", "self_hosted", "free_service"].includes(s.cost_model)).length;
  const integrations = services.filter((s) => s.integration);
  const configured = integrations.filter((s) => s.integration?.configured);
  const verified = integrations.filter((s) => s.provider_check?.ok).length;
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const infoCount = alerts.length - criticalCount - warningCount;
  const selected = services.find((s) => s.id === selectedId) ?? null;
  const hasFilters = Boolean(query || category || costModel || subscription || billing || attentionOnly);

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        <div className="flex flex-wrap gap-2">
          {configured.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => checkAll(configured)} disabled={checkingAll}>
              <ShieldCheck size={14} />
              {checkingAll ? "Checking…" : "Run provider checks"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          Could not refresh ({loadError.message}). Showing data from {fmtTimestamp(data.generated_at)}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Technologies"
          value={String(services.length)}
          icon={Boxes}
          hint={`${managed.length} with a provider account, ${noBill} free, open-source or self-hosted`}
          index={0}
        />
        <MetricCard
          label="Subscriptions recorded"
          value={`${recorded} of ${managed.length}`}
          icon={ClipboardCheck}
          color={recorded === managed.length ? "success" : "warning"}
          hint={recorded === managed.length ? "All provider accounts have a record" : `${managed.length - recorded} not configured`}
          index={1}
        />
        <MetricCard
          label="Needs attention"
          value={String(criticalCount + warningCount)}
          icon={AlertTriangle}
          color={criticalCount > 0 ? "error" : warningCount > 0 ? "warning" : "success"}
          hint={`${criticalCount} critical, ${warningCount} warning, ${infoCount} note${infoCount === 1 ? "" : "s"}`}
          index={2}
        />
        <MetricCard
          label="Plans verified by API"
          value={`${verified} of ${integrations.length}`}
          icon={ShieldCheck}
          color={verified === integrations.length ? "success" : "primary"}
          hint={
            configured.length === integrations.length
              ? "Provider API checks are configured"
              : `${integrations.length - configured.length} API check${integrations.length - configured.length === 1 ? "" : "s"} not configured`
          }
          index={3}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card color="teal" className="flex flex-col gap-3">
          <div>
            <h2 className="font-semibold text-fg">Estimated recurring cost</h2>
            <p className="text-xs text-fg-muted">
              From manual records of Active subscriptions. Currencies are not converted.
            </p>
          </div>
          {costs.by_currency.length === 0 ? (
            <p className="text-sm text-fg-muted">Not configured: no Active subscription has an amount recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-fg-muted">
                  <th className="py-1.5 pr-3 font-medium">Currency</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Monthly</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Annual</th>
                  <th className="py-1.5 font-medium">Based on</th>
                </tr>
              </thead>
              <tbody>
                {costs.by_currency.map((c) => (
                  <tr key={c.currency} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 font-medium text-fg">{c.currency}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-fg">{fmtMoney(c.monthly, c.currency)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-fg">{fmtMoney(c.annual, c.currency)}</td>
                    <td className="py-1.5 text-xs text-fg-muted">
                      {c.service_count} service{c.service_count === 1 ? "" : "s"}
                      {c.usage_based_count > 0 && `, ${c.usage_based_count} usage-based estimate${c.usage_based_count === 1 ? "" : "s"}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {costs.excluded.length > 0 && (
            <div className="text-xs text-fg-muted">
              <p className="font-medium">Not included:</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {costs.excluded.map((e) => (
                  <li key={e.service_id}>
                    {e.service_name}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card color={criticalCount > 0 ? "error" : "teal"} className="flex flex-col gap-3">
          <div>
            <h2 className="font-semibold text-fg">Alerts</h2>
            <p className="text-xs text-fg-muted">
              Based only on recorded dates and statuses. A service that&apos;s responding is never treated as paid or active.
            </p>
          </div>
          {alerts.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing to flag in the recorded details.</p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {alerts.map((a) => (
                <AlertRow key={`${a.service_id}-${a.kind}`} alert={a} showService onOpen={() => setSelectedId(a.service_id)} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card color="teal" className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <div className="relative sm:col-span-2 xl:col-span-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-3 text-fg-muted" />
            <Input
              aria-label="Search services"
              placeholder="Search"
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by type" value={costModel} onChange={(e) => setCostModel(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(COST_MODEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by subscription status" value={subscription} onChange={(e) => setSubscription(e.target.value)}>
            <option value="">Subscription: any</option>
            {Object.entries(SUBSCRIPTION).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
            <option value={NOT_CONFIGURED}>Not configured</option>
            <option value={NO_SUBSCRIPTION}>No subscription</option>
          </Select>
          <Select aria-label="Filter by billing status" value={billing} onChange={(e) => setBilling(e.target.value)}>
            <option value="">Billing: any</option>
            {Object.entries(BILLING).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
            <option value={NOT_CONFIGURED}>Not configured</option>
            <option value={NO_SUBSCRIPTION}>No subscription</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
            Needs attention only
          </label>
          <span aria-live="polite">
            Showing {filtered.length} of {services.length}
          </span>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="font-medium text-primary underline-offset-2 hover:underline">
              Clear filters
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-fg-muted">
            <p>{services.length === 0 ? "No services are listed." : "No services match these filters."}</p>
            {hasFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Cards until there's room for all eight columns beside the sidebar. */}
            <table className="hidden w-full text-left text-sm xl:table">
              <thead>
                <tr className="border-b border-border text-xs text-fg-muted">
                  <th className="py-2 pr-3 font-medium">Service</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Plan / owner</th>
                  <th className="py-2 pr-3 font-medium">Subscription</th>
                  <th className="py-2 pr-3 font-medium">Billing</th>
                  <th className="py-2 pr-3 font-medium">Cost</th>
                  <th className="py-2 pr-3 font-medium">Dates</th>
                  <th className="py-2 font-medium">Source / last checked</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const state = subscriptionState(s, services);
                  return (
                    <tr
                      key={s.id}
                      className="cursor-pointer border-b border-border align-top last:border-0 hover:bg-card-hover"
                      onClick={() => setSelectedId(s.id)}
                    >
                      <td className="py-2.5 pr-3">
                        <button type="button" className="text-left font-medium text-fg underline-offset-2 hover:underline">
                          {s.name}
                        </button>
                        <p className="text-xs text-fg-muted">
                          {s.provider} · {CATEGORY_LABEL[s.category]}
                        </p>
                        {s.critical && (
                          <Badge variant="error" className="mt-1">
                            Critical
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={COST_MODEL[s.cost_model].variant} className="whitespace-nowrap">
                          {COST_MODEL[s.cost_model].label}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3">
                        <PlanCell service={s} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={state.variant} className="whitespace-nowrap">
                          {state.label}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3">
                        <BillingBadge service={s} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <CostCell service={s} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <DatesCell service={s} />
                      </td>
                      <td className="py-2.5">
                        <SourceCell service={s} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="flex flex-col gap-3 xl:hidden">
              {filtered.map((s) => {
                const state = subscriptionState(s, services);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className="flex w-full flex-col gap-2 rounded-xl border border-border p-3 text-left text-sm hover:bg-card-hover"
                    >
                      <span className="font-medium text-fg">{s.name}</span>
                      <span className="text-xs text-fg-muted">
                        {s.provider} · {CATEGORY_LABEL[s.category]}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        <Badge variant={COST_MODEL[s.cost_model].variant}>{COST_MODEL[s.cost_model].label}</Badge>
                        <Badge variant={state.variant}>{state.label}</Badge>
                        {s.can_record && s.subscription && (
                          <Badge variant={BILLING[s.subscription.billing_status].variant}>
                            Billing: {BILLING[s.subscription.billing_status].label}
                          </Badge>
                        )}
                        {s.critical && <Badge variant="error">Critical</Badge>}
                      </span>
                      {s.subscription && (
                        <span className="grid grid-cols-2 gap-2">
                          <CostCell service={s} />
                          <DatesCell service={s} />
                        </span>
                      )}
                      <SourceCell service={s} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      {selected && (
        <ServicePanel
          key={selected.id}
          service={selected}
          services={services}
          alerts={alerts.filter((a) => a.service_id === selected.id)}
          token={session.token}
          onClose={() => setSelectedId(null)}
          onChanged={() => load(session.token)}
        />
      )}
    </div>
  );
}
