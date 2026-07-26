import type { Role } from "@petropro/shared-types";

export type { Role };

export interface Session {
  token: string;
  userId: string;
  name: string;
  role: Role;
}

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
