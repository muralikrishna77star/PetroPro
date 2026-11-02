import type {
  AutoRenew,
  BillingFrequency,
  BillingStatus,
  SubscriptionStatus,
  TechCategory,
  TechCostModel,
  TechService,
} from "@/lib/api";

type Variant = "default" | "primary" | "success" | "warning" | "error";

export const CATEGORY_LABEL: Record<TechCategory, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  hosting: "Hosting",
  deployment: "Deployment & CI",
  source_control: "Source control",
  authentication: "Authentication",
  storage: "Storage",
  monitoring: "Monitoring",
  messaging: "Messaging",
  domains: "Domains",
  documents: "Documents",
  desktop: "Desktop",
};

export const COST_MODEL: Record<TechCostModel, { label: string; variant: Variant }> = {
  open_source: { label: "Open source", variant: "default" },
  built_in: { label: "Built in", variant: "default" },
  self_hosted: { label: "Self-hosted", variant: "default" },
  free_service: { label: "Free service", variant: "primary" },
  managed_service: { label: "Managed service", variant: "primary" },
  not_in_use: { label: "Not in use", variant: "default" },
};

export const SUBSCRIPTION: Record<SubscriptionStatus, { label: string; variant: Variant }> = {
  active: { label: "Active", variant: "success" },
  trial: { label: "Trial", variant: "warning" },
  expired: { label: "Expired", variant: "error" },
  cancelled: { label: "Cancelled", variant: "error" },
  unknown: { label: "Unknown", variant: "default" },
};

export const BILLING: Record<BillingStatus, { label: string; variant: Variant }> = {
  paid: { label: "Paid", variant: "success" },
  due: { label: "Due", variant: "warning" },
  overdue: { label: "Overdue", variant: "error" },
  not_applicable: { label: "Not applicable", variant: "default" },
  unknown: { label: "Unknown", variant: "default" },
};

export const FREQUENCY: Record<BillingFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  usage_based: "Usage-based",
  one_time: "One-time",
  none: "None",
  unknown: "Unknown",
};

export const AUTO_RENEW: Record<AutoRenew, string> = { yes: "Yes", no: "No", unknown: "Unknown" };

export const INTEGRATION_NAME = { vercel: "Vercel API", github: "GitHub API" } as const;

/** dd/mm/yyyy, the app's date format everywhere else. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** SQLite datetime('now') values are UTC "YYYY-MM-DD HH:MM:SS". */
export function fmtTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  return `${fmtDate(ts)} ${ts.slice(11, 16)} UTC`;
}

export function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Where a service's details came from, so manual and verified are never confused. Provider
 *  checks only ever confirm the plan, so subscription and billing status are always manual. */
export function dataSources(s: TechService): { label: string; date: string | null; tone: "verified" | "failed" | "muted" }[] {
  if (!s.can_record) return [{ label: "Codebase", date: null, tone: "muted" }];
  const sources: ReturnType<typeof dataSources> = [];
  if (s.subscription) sources.push({ label: "Manually recorded", date: s.subscription.updated_at, tone: "muted" });
  if (s.provider_check) {
    sources.push(
      s.provider_check.ok
        ? { label: "Plan verified by API", date: s.provider_check.checked_at, tone: "verified" }
        : { label: "API check failed", date: s.provider_check.checked_at, tone: "failed" },
    );
  }
  return sources.length > 0 ? sources : [{ label: "Not configured", date: null, tone: "muted" }];
}

/** Names of the fields in an audit entry's change list. */
export const FIELD_LABEL: Record<string, string> = {
  plan: "Plan",
  account_owner: "Account owner",
  subscription_status: "Subscription status",
  billing_status: "Billing status",
  billing_frequency: "Billing frequency",
  amount: "Amount",
  currency: "Currency",
  next_payment_date: "Next payment date",
  renewal_date: "Renewal / expiry date",
  auto_renew: "Auto-renewal",
  notes: "Notes",
};

export const HISTORY_ACTION: Record<string, string> = {
  create_tech_subscription: "Record created",
  update_tech_subscription: "Record updated",
  clear_tech_subscription: "Record cleared",
  verify_tech_subscription: "Provider check run",
};

/** How a service's subscription stands, in one phrase, for the table and filters. */
export function subscriptionState(s: TechService, all: TechService[]): { label: string; variant: Variant } {
  if (s.billed_with) {
    const parent = all.find((p) => p.id === s.billed_with);
    return { label: `Billed with ${parent?.name.replace(/ \(.*\)$/, "") ?? s.billed_with}`, variant: "default" };
  }
  if (!s.can_record) return { label: s.cost_model === "not_in_use" ? "Not in use" : "No subscription", variant: "default" };
  if (!s.subscription) return { label: "Not configured", variant: "default" };
  return SUBSCRIPTION[s.subscription.subscription_status];
}
