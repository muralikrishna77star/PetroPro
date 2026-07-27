/** Client-side "save for later" queue for in-progress walk-in bills — deliberately not a
 *  backend feature: an unsaved draft isn't a business record yet (no bill_no, no stock/ledger
 *  effect), so it belongs in localStorage like the attendant offline queue, not in SQLite. */

export interface BillingDraftLine {
  item_code: string;
  qty: number;
  /** Tank-fill mileage reading, captured together at billing time (see billing/page.tsx). */
  odometerOpening?: number;
  odometerClosing?: number;
  /** Set when this line was added from the Pending Order section to fulfill a specific order line. */
  orderLineId?: number;
}

export interface BillingDraft {
  id: string;
  savedAt: string;
  paymentType: "cash" | "upi" | "card" | "credit";
  customerCode: string;
  vehicleNo: string;
  orderNo: string;
  pumpCode: string;
  lines: BillingDraftLine[];
}

const STORAGE_KEY = "petropro.billing.drafts";

export function listDrafts(): BillingDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BillingDraft[]) : [];
  } catch {
    return [];
  }
}

export function saveDraft(draft: Omit<BillingDraft, "id" | "savedAt">): BillingDraft {
  const full: BillingDraft = {
    ...draft,
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
  };
  const drafts = [full, ...listDrafts()];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  return full;
}

export function deleteDraft(id: string): void {
  const drafts = listDrafts().filter((d) => d.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}
