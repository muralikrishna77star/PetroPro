"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Item, type Purchase } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { Combobox } from "@/components/ui/Combobox";

export default function PurchasesPage() {
  const session = useRequireSession(["super_admin", "owner"]);
  const [items, setItems] = useState<Item[]>([]);
  const [itemCode, setItemCode] = useState("");
  const [qty, setQty] = useState("");
  const [value, setValue] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function refresh(token: string) {
    api.listPurchases(token).then(setPurchases).catch(() => undefined);
  }

  useEffect(() => {
    if (!session) return;
    api
      .listItems(session.token)
      .then((data) => {
        setItems(data);
        if (data.length > 0) setItemCode(data[0].code);
      })
      .catch(() => undefined);
    refresh(session.token);
  }, [session]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.createPurchase(session.token, {
        item_code: itemCode,
        qty: Number(qty),
        value: Number(value),
        invoice_no: invoiceNo || undefined,
      });
      setQty("");
      setValue("");
      setInvoiceNo("");
      refresh(session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Purchase entry failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8">
        <Card color="emerald">
          <h1 className="mb-4 text-xl font-semibold text-primary">Record a Purchase</h1>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Combobox
              options={items.map((item) => ({ value: item.code, label: item.name }))}
              value={itemCode}
              onChange={setItemCode}
              placeholder="Type to search items..."
            />
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Quantity"
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Total value (₹)"
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </div>
            <input
              placeholder="Invoice no. (optional)"
              className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />

            {error && <p className="text-sm text-error">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Recording..." : "Record purchase"}
            </button>
          </form>
        </Card>

        <Card color="emerald">
          <h2 className="mb-4 text-lg font-semibold">Recent purchases</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border ">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Item</th>
                  <th className="py-2 pr-4">Qty</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2 pr-4">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} className="border-b border-border ">
                    <td className="py-2 pr-4">{p.pur_date}</td>
                    <td className="py-2 pr-4">{p.item_code}</td>
                    <td className="py-2 pr-4">{p.qty}</td>
                    <td className="py-2 pr-4">₹{p.value.toFixed(2)}</td>
                    <td className="py-2 pr-4">{p.invoice_no ?? "—"}</td>
                  </tr>
                ))}
                {purchases.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-fg-muted">
                      No purchases recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
