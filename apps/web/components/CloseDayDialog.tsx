"use client";

import { useEffect, useRef } from "react";
import type { CloseDaySales, CloseDaySummary } from "@/lib/api";

const money = (amount: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);
const qty = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

/** One sales table: each item's qty and value, with the bill count and total value underneath. */
function SalesTable({ title, sales }: { title: string; sales: CloseDaySales }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white">
        {title}
      </h3>
      {sales.items.length === 0 ? (
        <p className="px-1 text-sm text-fg-muted">No sales.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-fg-muted">
                <th className="py-1 pr-3 font-normal">Item</th>
                <th className="py-1 pr-3 text-right font-normal">Qty</th>
                <th className="py-1 text-right font-normal">Value</th>
              </tr>
            </thead>
            <tbody>
              {sales.items.map((item) => (
                <tr key={item.item_code} className="border-b border-border">
                  <td className="py-1 pr-3">{item.item_name}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{qty(item.qty)}</td>
                  <td className="py-1 text-right tabular-nums">{money(item.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-1 pr-3" colSpan={2}>
                  Total · {sales.bill_count} bill{sales.bill_count === 1 ? "" : "s"}
                </td>
                <td className="py-1 text-right tabular-nums">{money(sales.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

/** Close Day's confirmation, then its result: the day's sales and the closing cashier's own (qty
 *  and value by item), and which day billing moves on to. `closed` switches it from asking to
 *  reporting what was closed. */
export function CloseDayDialog({
  summary,
  closed,
  closing,
  error,
  onConfirm,
  onClose,
}: {
  summary: CloseDaySummary;
  closed: boolean;
  closing: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const nextDay = summary.next_date_open_now
    ? `Billing moves on to ${summary.next_date}.`
    : `The next billing day is ${summary.next_date}. Billing opens at ${summary.next_date_opens_at}.`;

  return (
    <dialog
      ref={ref}
      // Esc closes it too, but never while the close is in flight.
      onCancel={(e) => {
        e.preventDefault();
        if (!closing) onClose();
      }}
      aria-labelledby="close-day-title"
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl border border-border bg-bg-elevated p-0 text-fg backdrop:bg-black/50"
    >
      <div className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-5">
        <div>
          <h2 id="close-day-title" className="text-lg font-semibold">
            {closed ? `Day closed — ${summary.date}` : `Close billing for ${summary.date}?`}
          </h2>
          <p className={`mt-1 text-sm ${closed ? "font-medium text-success" : "text-fg-muted"}`}>
            {closed
              ? nextDay
              : `No more bills can be posted to ${summary.date} afterwards. ${nextDay}`}
          </p>
        </div>

        <SalesTable title={`Sales for the day — ${summary.date}`} sales={summary.day} />
        <SalesTable title={`Sales by ${summary.cashier.name}`} sales={summary.cashier} />

        {!closed && !summary.can_close && summary.close_blocked_reason && (
          <p className="text-sm font-medium text-warning">{summary.close_blocked_reason}</p>
        )}
        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          {closed ? (
            <button
              autoFocus
              onClick={onClose}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              OK
            </button>
          ) : (
            <>
              <button
                autoFocus
                onClick={onClose}
                disabled={closing}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={closing || !summary.can_close}
                className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90 disabled:opacity-50"
              >
                {closing ? "Closing..." : "Close Day"}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
