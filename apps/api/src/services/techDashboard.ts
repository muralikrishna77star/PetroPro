import type {
  TechAlert,
  TechCostTotal,
  TechDashboard,
  TechProviderCheck,
  TechProviderIntegration,
  TechService,
} from "@petropro/shared-types";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { techSubscriptionsRepo } from "../repositories/techSubscriptions.js";
import { GITHUB_REPO_OWNER, TECH_CATALOG, canRecordSubscription, type CatalogEntry } from "./techCatalog.js";

/** Renewals, payments and trial ends this many days out are flagged. */
export const ALERT_WINDOW_DAYS = 14;

const DEV_JWT_SECRET = "petropro-dev-secret-change-me";

export function integrationConfig(provider: TechProviderIntegration): { configured: boolean; missing: string[] } {
  const missing =
    provider === "vercel"
      ? [!config.vercelApiToken && "VERCEL_API_TOKEN", !config.vercelTeamId && "VERCEL_TEAM_ID"]
      : [!config.githubToken && "GITHUB_TOKEN"];
  const names = missing.filter((m): m is string => Boolean(m));
  return { configured: names.length === 0, missing: names };
}

/** Facts and versions only the running API can know. Never includes a secret's value. */
function runtimeDetails(entry: CatalogEntry, fastifyVersion: string): Pick<TechService, "version" | "version_source" | "facts"> {
  const facts = [...(entry.facts ?? [])];
  for (const pkg of entry.packages ?? []) facts.push({ label: pkg.dependency, value: `${pkg.version} (package.json)` });
  let version = entry.declared?.version ?? null;
  let source: TechService["version_source"] = entry.declared?.source ?? null;

  switch (entry.id) {
    case "nodejs":
      facts.unshift({ label: "Required (package.json engines)", value: entry.declared!.version });
      version = process.version.replace(/^v/, "");
      source = "runtime";
      break;
    case "fastify":
      facts.unshift({ label: "Declared (package.json)", value: entry.declared!.version });
      version = fastifyVersion;
      source = "runtime";
      break;
    case "sqlite": {
      const row = db.prepare("SELECT sqlite_version() AS v").get() as { v: string };
      version = row.v;
      source = "runtime";
      break;
    }
    case "flyio":
      facts.push({
        label: "This API process",
        value: process.env.FLY_APP_NAME
          ? `Running on Fly.io (app ${process.env.FLY_APP_NAME}, region ${process.env.FLY_REGION ?? "unknown"})`
          : "Not running on Fly.io (no FLY_APP_NAME), e.g. local development",
      });
      break;
    case "local-auth":
      facts.push({
        label: "JWT signing secret",
        value: config.jwtSecret === DEV_JWT_SECRET ? "Development default. Set JWT_SECRET." : "Custom secret is set",
      });
      break;
    case "google-signin":
      facts.push({
        label: "Configured on this API",
        value: config.googleClientId && config.googleClientSecret ? "Yes (client ID and secret set)" : "Not configured",
      });
      break;
    case "backups":
      facts.push({ label: "Location", value: "backups/ folder next to the database file" });
      break;
  }
  return { version, version_source: source, facts };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function fmt(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** Only what the records say. A service that responds is never taken as paid or active. */
export function serviceAlerts(service: TechService, today: string): TechAlert[] {
  const alerts: TechAlert[] = [];
  const add = (kind: TechAlert["kind"], severity: TechAlert["severity"], message: string, date: string | null = null) =>
    alerts.push({ service_id: service.id, service_name: service.name, kind, severity, message, date });
  const sub = service.subscription;

  if (service.provider_check && !service.provider_check.ok) {
    add("provider_check_failed", "warning", `Provider check failed: ${service.provider_check.error ?? "unknown error"}`);
  }
  if (!service.can_record) return alerts;

  if (!sub) {
    if (service.critical && service.cost_model === "managed_service") {
      add("unrecorded_critical", "info", "Critical service with no subscription details recorded");
    }
    return alerts;
  }

  const check = service.provider_check;
  if (check?.ok && check.plan && sub.plan && check.plan.toLowerCase() !== sub.plan.toLowerCase()) {
    add("plan_mismatch", "warning", `Recorded plan "${sub.plan}" differs from the provider's "${check.plan}"`);
  }

  if ((sub.subscription_status === "expired" || sub.subscription_status === "cancelled") && service.critical) {
    add("inactive_critical", "critical", `Critical service recorded as ${sub.subscription_status}`);
  }
  if (sub.subscription_status === "unknown" && service.critical && service.cost_model === "managed_service") {
    add("unrecorded_critical", "info", "Critical service whose subscription status isn't recorded");
  }
  const ended = sub.subscription_status === "expired" || sub.subscription_status === "cancelled";

  if (sub.billing_status === "overdue") {
    add("overdue_payment", "critical", "Payment recorded as overdue", sub.next_payment_date);
  } else if (sub.billing_status === "due") {
    const passed = sub.next_payment_date !== null && daysBetween(today, sub.next_payment_date) < 0;
    add(
      "payment_due",
      "warning",
      !sub.next_payment_date
        ? "Payment recorded as due"
        : passed
          ? `Payment was due on ${fmt(sub.next_payment_date)} and is still recorded as Due. Confirm whether it was paid.`
          : `Payment due on ${fmt(sub.next_payment_date)}`,
      sub.next_payment_date,
    );
  }

  // Nothing further falls due on a subscription recorded as ended.
  if (sub.next_payment_date && !ended) {
    const days = daysBetween(today, sub.next_payment_date);
    if (days < 0 && sub.billing_status !== "overdue" && sub.billing_status !== "due") {
      add("payment_date_passed", "warning", `Next payment date ${fmt(sub.next_payment_date)} has passed. Confirm it was paid and update the record.`, sub.next_payment_date);
    } else if (days >= 0 && days <= ALERT_WINDOW_DAYS && sub.billing_status !== "due" && sub.billing_status !== "overdue") {
      add("upcoming_payment", "info", `Next payment ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`} (${fmt(sub.next_payment_date)})`, sub.next_payment_date);
    }
  }

  if (sub.subscription_status === "trial" && !sub.renewal_date) {
    add("trial_no_end_date", "warning", "Recorded as a trial with no end date");
  }

  if (sub.renewal_date) {
    const days = daysBetween(today, sub.renewal_date);
    if (sub.subscription_status === "trial") {
      if (days < 0) add("trial_ended", "critical", `Trial ended on ${fmt(sub.renewal_date)} but is still recorded as a trial`, sub.renewal_date);
      else if (days <= ALERT_WINDOW_DAYS) add("trial_expiring", "warning", `Trial ends ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`} (${fmt(sub.renewal_date)})`, sub.renewal_date);
    } else if (!ended) {
      // Includes "unknown": a recorded date is worth flagging even when the status isn't known.
      if (days < 0) {
        add("renewal_date_passed", "warning", `Renewal/expiry date ${fmt(sub.renewal_date)} has passed. Confirm the subscription is still active.`, sub.renewal_date);
      } else if (days <= ALERT_WINDOW_DAYS) {
        if (sub.auto_renew === "no") {
          add("no_auto_renew", "critical", `Expires ${fmt(sub.renewal_date)} and auto-renewal is off`, sub.renewal_date);
        } else {
          add("upcoming_renewal", sub.auto_renew === "yes" ? "info" : "warning", `Renews ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`} (${fmt(sub.renewal_date)})${sub.auto_renew === "unknown" ? ", auto-renewal not recorded" : ""}`, sub.renewal_date);
        }
      }
    }
  }
  return alerts;
}

/** usage_based counts its recorded amount as a typical month, and is reported separately in
 *  usage_based_count because it's an estimate rather than a fixed price. */
const PER_MONTH: Partial<Record<string, number>> = { monthly: 1, quarterly: 1 / 3, annual: 1 / 12, usage_based: 1 };

/** Estimated recurring cost from manual records only, per currency (never converted). */
export function recurringCosts(services: TechService[]): TechDashboard["costs"] {
  const totals = new Map<string, TechCostTotal>();
  const excluded: TechDashboard["costs"]["excluded"] = [];
  for (const s of services) {
    const sub = s.subscription;
    if (!sub || !s.can_record || sub.subscription_status !== "active") continue;
    if (sub.billing_frequency === "none" && !sub.amount) continue;
    if (sub.amount === null || !sub.currency) {
      excluded.push({ service_id: s.id, service_name: s.name, reason: "Active, but no amount recorded" });
      continue;
    }
    const factor = PER_MONTH[sub.billing_frequency];
    if (factor === undefined) {
      if (sub.billing_frequency !== "none" || sub.amount > 0) {
        excluded.push({ service_id: s.id, service_name: s.name, reason: `Billing frequency is ${sub.billing_frequency.replace("_", " ")}` });
      }
      continue;
    }
    const total = totals.get(sub.currency) ?? { currency: sub.currency, monthly: 0, annual: 0, service_count: 0, usage_based_count: 0 };
    total.monthly += sub.amount * factor;
    total.annual += sub.amount * factor * 12;
    total.service_count += 1;
    if (sub.billing_frequency === "usage_based") total.usage_based_count += 1;
    totals.set(sub.currency, total);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    by_currency: [...totals.values()]
      .map((t) => ({ ...t, monthly: round(t.monthly), annual: round(t.annual) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    excluded,
  };
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

export function buildTechDashboard(fastifyVersion: string, today = new Date().toISOString().slice(0, 10)): TechDashboard {
  const subscriptions = techSubscriptionsRepo.all();
  const checks = techSubscriptionsRepo.allChecks();

  const services: TechService[] = TECH_CATALOG.map((entry) => ({
    id: entry.id,
    name: entry.name,
    category: entry.category,
    provider: entry.provider,
    cost_model: entry.cost_model,
    critical: entry.critical,
    ...runtimeDetails(entry, fastifyVersion),
    purpose: entry.purpose,
    used_in: entry.used_in,
    impact_if_unavailable: entry.impact_if_unavailable,
    links: entry.links,
    integration: entry.integration
      ? { provider: entry.integration.provider, verifies: entry.integration.verifies, ...integrationConfig(entry.integration.provider) }
      : null,
    billed_with: entry.billed_with ?? null,
    can_record: canRecordSubscription(entry),
    subscription: canRecordSubscription(entry) ? (subscriptions.get(entry.id) ?? null) : null,
    provider_check: checks.get(entry.id) ?? null,
  }));

  const alerts = services
    .flatMap((s) => serviceAlerts(s, today))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.date ?? "9").localeCompare(b.date ?? "9"));

  return { generated_at: new Date().toISOString(), today, services, alerts, costs: recurringCosts(services) };
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Asks the provider's documented read-only API for the plan. Only the plan (and account
 * name) is taken from the response; nothing here decides whether a subscription is active or
 * paid. Tokens go in the request header only and never into the stored result or an error.
 *   - Vercel: GET https://api.vercel.com/v2/teams/{teamId} → billing.plan (hobby | pro | enterprise)
 *   - GitHub: GET https://api.github.com/user → plan.name, login. That's the token holder's own
 *     plan, so it only counts as verified when the token holder owns the repository.
 */
export async function runProviderCheck(
  integration: TechProviderIntegration,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Omit<TechProviderCheck, "checked_at">> {
  const base = { integration, plan: null, account: null };
  const { configured, missing } = integrationConfig(integration);
  if (!configured) return { ...base, ok: false, error: `Not configured: set ${missing.join(", ")} on the API server` };

  const request =
    integration === "vercel"
      ? {
          name: "Vercel API",
          url: `https://api.vercel.com/v2/teams/${encodeURIComponent(config.vercelTeamId)}`,
          headers: { Authorization: `Bearer ${config.vercelApiToken}` } as Record<string, string>,
        }
      : {
          name: "GitHub API",
          url: "https://api.github.com/user",
          headers: {
            Authorization: `Bearer ${config.githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "PetroPro-tech-dashboard",
          } as Record<string, string>,
        };

  let res;
  try {
    res = await fetchImpl(request.url, { headers: request.headers, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError";
    return { ...base, ok: false, error: timedOut ? `${request.name} did not respond within 10 seconds` : `Could not reach ${request.name}` };
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " (check the token and its access)"
        : res.status === 404 && integration === "vercel"
          ? " (check VERCEL_TEAM_ID)"
          : "";
    return { ...base, ok: false, error: `${request.name} returned HTTP ${res.status}${hint}` };
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (integration === "vercel") {
    const billing = body?.billing as { plan?: unknown } | null | undefined;
    const plan = typeof billing?.plan === "string" ? billing.plan : null;
    const account = typeof body?.slug === "string" ? body.slug : typeof body?.name === "string" ? body.name : null;
    return plan
      ? { ...base, ok: true, plan, account, error: null }
      : { ...base, ok: false, account, error: "Vercel API response had no billing plan" };
  }
  const planObj = body?.plan as { name?: unknown } | undefined;
  const plan = typeof planObj?.name === "string" ? planObj.name : null;
  const account = typeof body?.login === "string" ? body.login : null;
  if (account?.toLowerCase() !== GITHUB_REPO_OWNER.toLowerCase()) {
    return {
      ...base,
      ok: false,
      account,
      error: `This token belongs to ${account ?? "an unnamed account"}, not the repository owner ${GITHUB_REPO_OWNER}, so its plan doesn't apply here`,
    };
  }
  return plan
    ? { ...base, ok: true, plan, account, error: null }
    : { ...base, ok: false, account, error: "GitHub API response had no plan" };
}
