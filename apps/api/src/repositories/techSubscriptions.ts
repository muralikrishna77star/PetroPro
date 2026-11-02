import type {
  AutoRenew,
  BillingFrequency,
  BillingStatus,
  SubscriptionStatus,
  TechProviderCheck,
  TechProviderIntegration,
  TechSubscriptionInput,
  TechSubscriptionRecord,
} from "@petropro/shared-types";
import { db } from "../db/client.js";

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["active", "trial", "expired", "cancelled", "unknown"];
export const BILLING_STATUSES: BillingStatus[] = ["paid", "due", "overdue", "not_applicable", "unknown"];
export const BILLING_FREQUENCIES: BillingFrequency[] = [
  "monthly",
  "quarterly",
  "annual",
  "usage_based",
  "one_time",
  "none",
  "unknown",
];
export const AUTO_RENEW: AutoRenew[] = ["yes", "no", "unknown"];

const TEXT_LIMITS = { plan: 100, account_owner: 200, notes: 1000 } as const;

interface SubscriptionRow extends Omit<TechSubscriptionRecord, never> {
  service_id: string;
}

interface CheckRow {
  service_id: string;
  integration: TechProviderIntegration;
  checked_at: string;
  ok: number;
  plan: string | null;
  account: string | null;
  error: string | null;
}

/**
 * Refuses text that looks like a credential or a card number. The dashboard must never hold or
 * show either, and a notes box is exactly where someone would paste one by mistake.
 */
export function looksSecret(text: string): string | null {
  if (/\b(ghp|gho|ghs|ghu|github_pat|sk|pk|rk|xox[abp]|vc[pkiar]|fm[12])_[A-Za-z0-9_]{10,}/.test(text)) return "an API token";
  if (/\bFlyV1\s+\S+|\bAIza[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b/.test(text)) return "an API token";
  if (/\bBearer\s+\S{16,}/i.test(text)) return "a bearer token";
  if (/(password|passwd|pwd|secret|api[_ -]?key|token)\s*[:=]\s*\S+/i.test(text)) return "a password or key";
  // 32+ unbroken letters-and-digits, e.g. a pasted key. "/" and "." are left out so URLs and
  // emails still pass.
  for (const match of text.matchAll(/[A-Za-z0-9+_-]{32,}/g)) {
    if (/\d/.test(match[0]) && /[A-Za-z]/.test(match[0])) return "a long key-like string";
  }
  if (/\b(cvv|cvc)\b\s*[:=]?\s*\d{3,4}\b/i.test(text)) return "a card security code";
  for (const match of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    if (luhnValid(match[0].replace(/\D/g, ""))) return "a payment card number";
  }
  return null;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function cleanText(field: keyof typeof TEXT_LIMITS, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > TEXT_LIMITS[field]) throw new Error(`${field} must be at most ${TEXT_LIMITS[field]} characters`);
  const secret = looksSecret(trimmed);
  if (secret) throw new Error(`${field} looks like it contains ${secret}. Don't store credentials or card details here.`);
  return trimmed;
}

function oneOf<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
  if (value === undefined || value === null || value === "") return "unknown" as T;
  if (!allowed.includes(value as T)) throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function cleanDate(field: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !isIsoDate(value)) throw new Error(`${field} must be a date (YYYY-MM-DD)`);
  return value;
}

/** Validates and normalizes a manual record. Throws Error with a user-facing message. */
export function validateSubscriptionInput(body: Partial<TechSubscriptionInput>): TechSubscriptionInput {
  let amount: number | null = null;
  const rawAmount: unknown = body.amount;
  if (rawAmount !== undefined && rawAmount !== null && rawAmount !== "") {
    amount = typeof rawAmount === "number" || typeof rawAmount === "string" ? Number(rawAmount) : NaN;
    if (!Number.isFinite(amount) || amount < 0) throw new Error("amount must be a number of 0 or more");
    amount = Math.round(amount * 100) / 100;
  }
  let currency: string | null = null;
  if (typeof body.currency === "string" && body.currency.trim()) {
    currency = body.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be a 3-letter ISO code, e.g. INR or USD");
  }
  if (amount !== null && currency === null) throw new Error("currency is required when an amount is entered");

  return {
    plan: cleanText("plan", body.plan),
    account_owner: cleanText("account_owner", body.account_owner),
    subscription_status: oneOf("subscription_status", body.subscription_status, SUBSCRIPTION_STATUSES),
    billing_status: oneOf("billing_status", body.billing_status, BILLING_STATUSES),
    billing_frequency: oneOf("billing_frequency", body.billing_frequency, BILLING_FREQUENCIES),
    amount,
    currency,
    next_payment_date: cleanDate("next_payment_date", body.next_payment_date),
    renewal_date: cleanDate("renewal_date", body.renewal_date),
    auto_renew: oneOf("auto_renew", body.auto_renew, AUTO_RENEW),
    notes: cleanText("notes", body.notes),
  };
}

function toRecord(row: SubscriptionRow): TechSubscriptionRecord {
  const { service_id: _id, ...rest } = row;
  return rest;
}

export const techSubscriptionsRepo = {
  all(): Map<string, TechSubscriptionRecord> {
    const rows = db.prepare("SELECT * FROM tech_subscriptions").all() as unknown as SubscriptionRow[];
    return new Map(rows.map((r) => [r.service_id, toRecord(r)]));
  },

  get(serviceId: string): TechSubscriptionRecord | null {
    const row = db.prepare("SELECT * FROM tech_subscriptions WHERE service_id = ?").get(serviceId) as
      | SubscriptionRow
      | undefined;
    return row ? toRecord(row) : null;
  },

  upsert(serviceId: string, input: TechSubscriptionInput, userId: string): TechSubscriptionRecord {
    db.prepare(
      `INSERT INTO tech_subscriptions (service_id, plan, account_owner, subscription_status, billing_status,
         billing_frequency, amount, currency, next_payment_date, renewal_date, auto_renew, notes, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(service_id) DO UPDATE SET
         plan = excluded.plan, account_owner = excluded.account_owner,
         subscription_status = excluded.subscription_status, billing_status = excluded.billing_status,
         billing_frequency = excluded.billing_frequency, amount = excluded.amount, currency = excluded.currency,
         next_payment_date = excluded.next_payment_date, renewal_date = excluded.renewal_date,
         auto_renew = excluded.auto_renew, notes = excluded.notes,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(
      serviceId,
      input.plan,
      input.account_owner,
      input.subscription_status,
      input.billing_status,
      input.billing_frequency,
      input.amount,
      input.currency,
      input.next_payment_date,
      input.renewal_date,
      input.auto_renew,
      input.notes,
      userId,
    );
    return this.get(serviceId)!;
  },

  remove(serviceId: string): boolean {
    return db.prepare("DELETE FROM tech_subscriptions WHERE service_id = ?").run(serviceId).changes > 0;
  },

  allChecks(): Map<string, TechProviderCheck> {
    const rows = db.prepare("SELECT * FROM tech_provider_checks").all() as unknown as CheckRow[];
    return new Map(rows.map((r) => [r.service_id, toCheck(r)]));
  },

  recordCheck(serviceId: string, check: Omit<TechProviderCheck, "checked_at">): TechProviderCheck {
    db.prepare(
      `INSERT INTO tech_provider_checks (service_id, integration, checked_at, ok, plan, account, error)
       VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
       ON CONFLICT(service_id) DO UPDATE SET integration = excluded.integration, checked_at = excluded.checked_at,
         ok = excluded.ok, plan = excluded.plan, account = excluded.account, error = excluded.error`,
    ).run(serviceId, check.integration, check.ok ? 1 : 0, check.plan, check.account, check.error);
    const row = db.prepare("SELECT * FROM tech_provider_checks WHERE service_id = ?").get(serviceId) as unknown as CheckRow;
    return toCheck(row);
  },
};

function toCheck(row: CheckRow): TechProviderCheck {
  return {
    integration: row.integration,
    checked_at: row.checked_at,
    ok: row.ok === 1,
    plan: row.plan,
    account: row.account,
    error: row.error,
  };
}
