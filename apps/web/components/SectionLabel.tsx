import type { ReactNode } from "react";

/** Dark title bar for a field grouping within a Card (Sale Type / Vehicle Details / Pump
 *  Details / Mileage Check on Billing, and the same sections on the customer's Purchase Order
 *  screen) — deliberately not theme-reactive so the label always reads as a fixed-contrast
 *  heading regardless of light/dark mode. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white">
      {children}
    </div>
  );
}
