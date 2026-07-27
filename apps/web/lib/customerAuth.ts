/** A customer's own session — deliberately parallel to (never merged with) apps/web/lib/auth.ts's
 *  staff `Session`: different storage key, different shape, so a customer and a staff member can
 *  never collide or be confused for one another on the same device. */
export interface CustomerSession {
  token: string;
  customerCode: string;
  name: string;
}

const STORAGE_KEY = "petropro.customerSession";

export function saveCustomerSession(session: CustomerSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getCustomerSession(): CustomerSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as CustomerSession) : null;
}

export function clearCustomerSession() {
  localStorage.removeItem(STORAGE_KEY);
}
