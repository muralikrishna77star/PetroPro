"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadAuthed, type Item, type PendingTransaction, type SettleResponse, type Tenant } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { Combobox } from "@/components/ui/Combobox";
import { PaymentQrPanel } from "@/components/PaymentQrPanel";
import { printReferenceSlip } from "@/lib/printSlip";

export default function CashierPage() {
  const session = useRequireSession(["super_admin", "owner", "operator"]);
  const [queue, setQueue] = useState<PendingTransaction[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [extraItemCode, setExtraItemCode] = useState("");
  const [extraQty, setExtraQty] = useState("");
  const [extraLines, setExtraLines] = useState<{ item_code: string; qty: number }[]>([]);
  const [paymentType, setPaymentType] = useState("cash");
  const [upiConfirmed, setUpiConfirmed] = useState(false);
  const [invoice, setInvoice] = useState<SettleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const tenantName = tenant?.name ?? "PetroPro";

  const refreshQueue = useCallback(() => {
    if (!session) return;
    api.listPendingTransactions(session.token).then(setQueue).catch(() => undefined);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    api.listItems(session.token).then(setItems).catch(() => undefined);
    api.getTenant(session.token).then(setTenant).catch(() => undefined);
    refreshQueue();
    const interval = setInterval(refreshQueue, 5000);
    return () => clearInterval(interval);
  }, [session, refreshQueue]);

  function printPendingSlip(tx: PendingTransaction) {
    const item = items.find((i) => i.code === tx.item_code);
    const qty = tx.qty ?? (tx.amount && item ? tx.amount / item.price_retail : 0);
    printReferenceSlip({
      tenantName,
      heading: "PENDING — awaiting payment, not a tax invoice",
      vehicleNo: tx.vehicle_no,
      lines: [{ itemName: item?.name ?? tx.item_code, qty, rate: item?.price_retail ?? 0 }],
      time: new Date(tx.created_at).toLocaleTimeString(),
      footer: "Present at cashier to pay and receive invoice",
    });
  }

  function addExtraLine() {
    if (!extraItemCode || !extraQty) return;
    setExtraLines((prev) => [...prev, { item_code: extraItemCode, qty: Number(extraQty) }]);
    setExtraQty("");
  }

  function selectPaymentType(next: string) {
    setPaymentType(next);
    setUpiConfirmed(false);
  }

  async function handleSettle() {
    if (!session || selectedId === null) return;
    if (paymentType === "upi" && !upiConfirmed) return;
    setError(null);
    setSettling(true);
    try {
      const result = await api.settleBill(session.token, {
        pendingId: selectedId,
        paymentType,
        extraLines: extraLines.length > 0 ? extraLines : undefined,
      });
      setInvoice(result);
      setSelectedId(null);
      setExtraLines([]);
      setUpiConfirmed(false);
      refreshQueue();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Settlement failed");
    } finally {
      setSettling(false);
    }
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold text-primary">Cashier — Pending Queue</h1>

      <ul className="mb-6 flex flex-col gap-2">
        {queue.length === 0 && <li className="text-sm text-fg-muted">No pending transactions.</li>}
        {queue.map((tx) => (
          <li key={tx.id} className="flex items-stretch gap-2">
            <button
              onClick={() => {
                setSelectedId(tx.id);
                setUpiConfirmed(false);
              }}
              className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                selectedId === tx.id
                  ? "border-primary bg-primary/10 "
                  : "border-border hover:bg-card-hover  "
              }`}
            >
              <span className="font-medium">{tx.vehicle_no}</span> — {tx.item_code} —{" "}
              {tx.qty ? `${tx.qty} L` : `₹${tx.amount}`}
              {tx.odometer ? ` — odo ${tx.odometer}` : ""}
            </button>
            <button
              onClick={() => printPendingSlip(tx)}
              title="Print a reference slip (not a tax invoice — this entry hasn't been paid yet)"
              className="shrink-0 rounded-lg border border-border px-3 text-sm text-fg-muted hover:bg-card-hover"
            >
              Print
            </button>
          </li>
        ))}
      </ul>

      {selectedId !== null && (
        <Card color="orange" className="mb-6">
          <h2 className="mb-3 font-medium">Add lubricants / accessories (optional)</h2>
          <div className="mb-3 flex gap-2">
            <Combobox
              options={items.map((item) => ({ value: item.code, label: item.name }))}
              value={extraItemCode}
              onChange={setExtraItemCode}
              placeholder="Select item"
              className="flex-1"
            />
            <input
              type="number"
              min="0"
              step="1"
              placeholder="Qty"
              className="w-20 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={extraQty}
              onChange={(e) => setExtraQty(e.target.value)}
            />
            <button
              onClick={addExtraLine}
              className="rounded-lg border border-border px-3 py-2 text-sm "
            >
              Add
            </button>
          </div>
          {extraLines.length > 0 && (
            <ul className="mb-3 text-sm text-fg-muted dark:text-zinc-400">
              {extraLines.map((l, i) => (
                <li key={i}>
                  {l.qty} × {l.item_code}
                </li>
              ))}
            </ul>
          )}

          <label className="mb-1 block text-sm font-medium">Payment type</label>
          <select
            className="mb-4 w-full rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
            value={paymentType}
            onChange={(e) => selectPaymentType(e.target.value)}
          >
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="credit">Credit</option>
          </select>

          {paymentType === "upi" && (
            <PaymentQrPanel
              qrCode={tenant?.payment_qr_code ?? null}
              confirmed={upiConfirmed}
              onConfirmChange={setUpiConfirmed}
            />
          )}

          {error && <p className="mb-3 text-sm text-error">{error}</p>}

          <button
            onClick={handleSettle}
            disabled={settling || (paymentType === "upi" && !upiConfirmed)}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {settling ? "Settling..." : "Accept payment & print bill"}
          </button>
        </Card>
      )}

      {invoice && (
        <div className="rounded-2xl border border-success/40 bg-success/10 p-4 text-sm  ">
          <h2 className="mb-2 font-medium text-success ">
            Invoice #{invoice.bill.bill_no}
          </h2>
          <ul className="mb-2">
            {invoice.lines.map((line) => (
              <li key={line.id}>
                {line.qty} × {line.item_code} = ₹{line.amount.toFixed(2)}
              </li>
            ))}
          </ul>
          <p>Sub total: ₹{invoice.bill.sub_total.toFixed(2)}</p>
          <p>Tax: ₹{invoice.bill.tax_total.toFixed(2)}</p>
          <p className="font-semibold">Grand total: ₹{invoice.bill.grand_total.toFixed(2)}</p>
          <p className="mt-2 italic">{invoice.amountInWords}</p>
          <button
            onClick={() =>
              downloadAuthed(
                api.invoicePdfUrl(invoice.bill.bill_no),
                session.token,
                `invoice-${invoice.bill.bill_no}.pdf`,
                "open",
              )
            }
            className="mt-3 rounded-lg border border-success px-3 py-1.5 text-sm text-success "
          >
            Print Bill
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
