import type { Role } from "@petropro/shared-types";

export type { Role };

export interface Session {
  token: string;
  userId: string;
  name: string;
  role: Role;
  /** A cashier limited to the Billing screen. The API enforces it too; this only shapes the app. */
  billingOnly?: boolean;
}

/** The one screen a "Billing screen only" account may open. */
export const BILLING_ONLY_HOME = "/billing";

const STORAGE_KEY = "petropro.session";

export function saveSession(session: Session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function homeRouteForRole(role: Role): string {
  return role === "field_operator" ? "/attendant" : "/cashier";
}

/** Where a signed-in user starts: their role's home, or Billing for a billing-only cashier. */
export function homeRouteFor(session: Pick<Session, "role" | "billingOnly">): string {
  return session.billingOnly ? BILLING_ONLY_HOME : homeRouteForRole(session.role);
}

/** Display label for a role's account tier (used in the sidebar/header user menu). */
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  owner: "Owner",
  operator: "Operator",
  field_operator: "Field Operator",
};

/** Portal name for the shell/branding — `operator` and `field_operator` share one portal
 *  (Operator Portal) since both are frontline staff, they just do different steps of the
 *  attendant→cashier handoff. */
export function portalForRole(role: Role): string {
  if (role === "super_admin") return "Super Admin Portal";
  if (role === "owner") return "Owner Portal";
  return "Operator Portal";
}
