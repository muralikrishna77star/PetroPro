"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Info, RefreshCw, ShieldCheck, X } from "lucide-react";
import {
  ApiError,
  techApi,
  type AuditLog,
  type AutoRenew,
  type BillingFrequency,
  type BillingStatus,
  type SubscriptionStatus,
  type TechAlert,
  type TechService,
  type TechSubscriptionInput,
} from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import {
  AUTO_RENEW,
  BILLING,
  CATEGORY_LABEL,
  COST_MODEL,
  FIELD_LABEL,
  FREQUENCY,
  HISTORY_ACTION,
  INTEGRATION_NAME,
  SUBSCRIPTION,
  dataSources,
  fmtMoney,
  fmtTimestamp,
  subscriptionState,
} from "./labels";

const EMPTY: TechSubscriptionInput = {
  plan: null,
  account_owner: null,
  subscription_status: "unknown",
  billing_status: "unknown",
  billing_frequency: "unknown",
  amount: null,
  currency: null,
  next_payment_date: null,
  renewal_date: null,
  auto_renew: "unknown",
  notes: null,
};

function toForm(service: TechService): TechSubscriptionInput {
  const sub = service.subscription;
  if (!sub) return EMPTY;
  return {
    plan: sub.plan,
    account_owner: sub.account_owner,
    subscription_status: sub.subscription_status,
    billing_status: sub.billing_status,
    billing_frequency: sub.billing_frequency,
    amount: sub.amount,
    currency: sub.currency,
    next_payment_date: sub.next_payment_date,
    renewal_date: sub.renewal_date,
    auto_renew: sub.auto_renew,
    notes: sub.notes,
  };
}

/** One audit entry's details as readable lines. Details are JSON written by routes/techDashboard.ts. */
function historyLines(log: AuditLog): string[] {
  let details: { changes?: Record<string, { from: unknown; to: unknown }>; plan?: unknown; ok?: unknown; error?: unknown };
  try {
    details = JSON.parse(log.details ?? "{}");
  } catch {
    return [];
  }
  if (log.action === "verify_tech_subscription") {
    return [details.ok ? `Plan: ${String(details.plan)}` : `Failed: ${String(details.error)}`];
  }
  const show = (v: unknown) => (v === null || v === undefined ? "blank" : String(v));
  return Object.entries(details.changes ?? {}).map(
    ([field, c]) => `${FIELD_LABEL[field] ?? field}: ${show(c.from)} → ${show(c.to)}`,
  );
}

const SEVERITY_STYLE: Record<TechAlert["severity"], string> = {
  critical: "border-error/40 bg-error/10 text-error",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info: "border-border bg-card-hover text-fg-muted",
};

export function AlertRow({ alert, showService = false, onOpen }: { alert: TechAlert; showService?: boolean; onOpen?: () => void }) {
  const Icon = alert.severity === "info" ? Info : AlertTriangle;
  return (
    <li className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", SEVERITY_STYLE[alert.severity])}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">
        {showService && (
          <button type="button" onClick={onOpen} className="mr-1 font-semibold underline-offset-2 hover:underline">
            {alert.service_name}:
          </button>
        )}
        {alert.message}
      </span>
    </li>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs font-medium text-fg-muted", className)}>
      {label}
      {children}
    </label>
  );
}

export function ServicePanel({
  service,
  services,
  alerts,
  token,
  onClose,
  onChanged,
}: {
  service: TechService;
  services: TechService[];
  alerts: TechAlert[];
  token: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<TechSubscriptionInput>(() => toForm(service));
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditLog[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  function loadHistory() {
    techApi
      .getHistory(token, service.id)
      .then((logs) => {
        setHistory(logs);
        setHistoryFailed(false);
      })
      .catch(() => setHistoryFailed(true));
  }

  useEffect(loadHistory, [token, service.id]);

  // Move focus into the panel on open, and hand it back to what opened it on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof TechSubscriptionInput>(key: K, value: TechSubscriptionInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const text = (v: string) => (v.trim() === "" ? null : v);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await techApi.saveSubscription(token, service.id, form);
      setNotice("Saved. The change is recorded in the audit log.");
      onChanged();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save. Is the API reachable?");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!window.confirm(`Clear the recorded subscription details for ${service.name}?`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await techApi.clearSubscription(token, service.id);
      setForm(EMPTY);
      setNotice("Record cleared.");
      onChanged();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not clear the record");
    } finally {
      setSaving(false);
    }
  }

  async function verify() {
    setChecking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await techApi.verify(token, service.id);
      setNotice(result.ok ? `Provider confirmed plan "${result.plan}".` : `Provider check failed: ${result.error}`);
      onChanged();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run the provider check");
    } finally {
      setChecking(false);
    }
  }

  const state = subscriptionState(service, services);
  const check = service.provider_check;
  const sub = service.subscription;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="service-panel-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-border bg-bg shadow-xl outline-none"
      >
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-bg px-5 py-4">
          <div className="flex-1">
            <h2 id="service-panel-title" className="font-heading text-lg font-semibold text-fg">
              {service.name}
            </h2>
            <p className="text-sm text-fg-muted">
              {service.provider} · {CATEGORY_LABEL[service.category]}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={COST_MODEL[service.cost_model].variant}>{COST_MODEL[service.cost_model].label}</Badge>
              <Badge variant={state.variant}>{state.label}</Badge>
              {sub && <Badge variant={BILLING[sub.billing_status].variant}>Billing: {BILLING[sub.billing_status].label}</Badge>}
              {service.critical && <Badge variant="error">Critical</Badge>}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close details">
            <X size={18} />
          </Button>
        </div>

        <div className="flex flex-col gap-6 px-5 py-5">
          {alerts.length > 0 && (
            <ul className="flex flex-col gap-2">
              {alerts.map((a, i) => (
                <AlertRow key={i} alert={a} />
              ))}
            </ul>
          )}

          <section className="flex flex-col gap-3 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Overview</h3>
            <p className="text-fg">{service.purpose}</p>
            <div>
              <p className="text-xs font-medium text-fg-muted">If it becomes unavailable</p>
              <p className="text-fg">{service.impact_if_unavailable}</p>
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
              <dt className="text-fg-muted">Data source</dt>
              <dd className="text-fg">
                {dataSources(service)
                  .map((d) => (d.date ? `${d.label} (${fmtTimestamp(d.date)})` : d.label))
                  .join("; ")}
              </dd>
              <dt className="text-fg-muted">Version</dt>
              <dd className="font-mono text-fg">
                {service.version ?? "Not applicable"}
                {service.version_source && (
                  <span className="ml-2 font-sans text-xs text-fg-muted">
                    ({service.version_source === "runtime" ? "detected on the running API" : `declared in ${service.version_source}`})
                  </span>
                )}
              </dd>
              {service.facts.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-fg-muted">{f.label}</dt>
                  <dd className="text-fg">{f.value}</dd>
                </div>
              ))}
            </dl>
            {service.used_in.length > 0 && (
              <div>
                <p className="text-xs font-medium text-fg-muted">Used in</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {service.used_in.map((u) => (
                    <li key={u} className="rounded bg-card-hover px-2 py-0.5 font-mono text-xs text-fg">
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {service.links.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {service.links.map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-card-hover"
                  >
                    {l.label} <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            )}
          </section>

          {service.integration && (
            <section className="flex flex-col gap-2 rounded-xl border border-border p-4 text-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-primary" />
                <h3 className="flex-1 font-semibold text-fg">Provider check: {INTEGRATION_NAME[service.integration.provider]}</h3>
                <Button size="sm" variant="outline" onClick={verify} disabled={checking || !service.integration.configured}>
                  <RefreshCw size={14} className={checking ? "animate-spin" : ""} />
                  {checking ? "Checking…" : "Check now"}
                </Button>
              </div>
              <p className="text-xs text-fg-muted">
                Confirms: {service.integration.verifies}. It does not confirm payment or whether the subscription is active,
                so those stay manual.
              </p>
              {!service.integration.configured && (
                <p className="text-fg-muted">
                  Not configured. Set <span className="font-mono">{service.integration.missing.join(", ")}</span> on the API
                  server.
                </p>
              )}
              {!check ? (
                service.integration.configured && <p className="text-fg-muted">Not checked yet.</p>
              ) : check.ok ? (
                <p className="text-fg">
                  <Badge variant="success">Verified</Badge> Plan <strong>{check.plan}</strong>
                  {check.account && <> for account <span className="font-mono">{check.account}</span></>}, checked{" "}
                  {fmtTimestamp(check.checked_at)}
                </p>
              ) : (
                <p className="text-error">
                  Last check failed ({fmtTimestamp(check.checked_at)}): {check.error}
                </p>
              )}
            </section>
          )}

          {service.can_record ? (
            <form onSubmit={save} className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="flex-1 text-sm font-semibold text-fg">Subscription & billing (manually recorded)</h3>
                <span className="text-xs text-fg-muted">
                  {sub ? `Last updated ${fmtTimestamp(sub.updated_at)} by ${sub.updated_by ?? "unknown"}` : "Not configured"}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Plan">
                  <Input value={form.plan ?? ""} onChange={(e) => set("plan", text(e.target.value))} placeholder="Unknown" maxLength={100} />
                </Field>
                <Field label="Account owner">
                  <Input
                    value={form.account_owner ?? ""}
                    onChange={(e) => set("account_owner", text(e.target.value))}
                    placeholder="Name or email of the account holder"
                    maxLength={200}
                  />
                </Field>
                <Field label="Subscription status">
                  <Select value={form.subscription_status} onChange={(e) => set("subscription_status", e.target.value as SubscriptionStatus)}>
                    {Object.entries(SUBSCRIPTION).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Billing status">
                  <Select value={form.billing_status} onChange={(e) => set("billing_status", e.target.value as BillingStatus)}>
                    {Object.entries(BILLING).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Billing frequency">
                  <Select value={form.billing_frequency} onChange={(e) => set("billing_frequency", e.target.value as BillingFrequency)}>
                    {Object.entries(FREQUENCY).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <Field label="Amount per period (a typical month if usage-based)">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={form.amount ?? ""}
                      onChange={(e) => set("amount", e.target.value === "" ? null : Number(e.target.value))}
                      placeholder="Unknown"
                    />
                  </Field>
                  <Field label="Currency">
                    <Input
                      value={form.currency ?? ""}
                      onChange={(e) => set("currency", text(e.target.value.toUpperCase()))}
                      placeholder="INR"
                      maxLength={3}
                    />
                  </Field>
                </div>
                <Field label="Next payment date">
                  <Input type="date" value={form.next_payment_date ?? ""} onChange={(e) => set("next_payment_date", text(e.target.value))} />
                </Field>
                <Field label="Renewal / expiry date (trial end for trials)">
                  <Input type="date" value={form.renewal_date ?? ""} onChange={(e) => set("renewal_date", text(e.target.value))} />
                </Field>
                <Field label="Auto-renewal">
                  <Select value={form.auto_renew} onChange={(e) => set("auto_renew", e.target.value as AutoRenew)}>
                    {Object.entries(AUTO_RENEW).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Notes" className="sm:col-span-2">
                  <textarea
                    className="min-h-20 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-primary/60"
                    value={form.notes ?? ""}
                    onChange={(e) => set("notes", text(e.target.value))}
                    maxLength={1000}
                    placeholder="e.g. invoice email, which card nickname pays it. Never passwords, API keys or card numbers."
                  />
                </Field>
              </div>
              {form.amount !== null && form.currency && form.billing_frequency !== "unknown" && (
                <p className="text-xs text-fg-muted">
                  {fmtMoney(form.amount, form.currency)} {FREQUENCY[form.billing_frequency].toLowerCase()}
                  {form.subscription_status !== "active" && " (only Active subscriptions count toward recurring cost)"}
                  {form.billing_frequency === "usage_based" && " (counted as an estimate of a typical month)"}
                </p>
              )}
              {error && <p className="text-sm text-error">{error}</p>}
              {notice && <p className="text-sm text-success">{notice}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save record"}
                </Button>
                {sub && (
                  <Button type="button" variant="outline" onClick={clear} disabled={saving}>
                    Clear record
                  </Button>
                )}
              </div>
              <p className="text-xs text-fg-muted">
                Saving only updates this dashboard. Nothing is purchased, renewed or cancelled with the provider.
              </p>
            </form>
          ) : (
            <section className="rounded-xl border border-border p-4 text-sm text-fg-muted">
              {service.billed_with
                ? `${state.label}. Record its cost on that service so it isn't counted twice.`
                : service.cost_model === "not_in_use"
                  ? "Nothing is set up for this, so there's no subscription to track."
                  : `${COST_MODEL[service.cost_model].label}: no provider subscription or billing applies.`}
              {(error || notice) && <p className={cn("mt-2", error ? "text-error" : "text-success")}>{error ?? notice}</p>}
            </section>
          )}

          <section className="flex flex-col gap-2 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Change history</h3>
            {historyFailed ? (
              <p className="text-error">Could not load the change history.</p>
            ) : history === null ? (
              <p className="text-fg-muted">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-fg-muted">No manual changes or provider checks recorded.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.map((log) => (
                  <li key={log.id} className="rounded-lg border border-border px-3 py-2">
                    <p className="text-fg">
                      {HISTORY_ACTION[log.action] ?? log.action}
                      <span className="text-xs text-fg-muted"> · {fmtTimestamp(log.created_at)} by {log.user_id ?? "unknown"}</span>
                    </p>
                    {historyLines(log).map((line) => (
                      <p key={line} className="break-words text-xs text-fg-muted">
                        {line}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
