"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Item, type RateChange } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { Combobox } from "@/components/ui/Combobox";

export default function RateChangesPage() {
  const session = useRequireSession(["super_admin", "owner"]);
  const [items, setItems] = useState<Item[]>([]);
  const [itemCode, setItemCode] = useState("");
  const [rate, setRate] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [changes, setChanges] = useState<RateChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function refresh(token: string) {
    api.listRateChanges(token).then(setChanges).catch(() => undefined);
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
      await api.createRateChange(session.token, {
        item_code: itemCode,
        rate: Number(rate),
        scheduled_on: scheduledOn,
      });
      setRate("");
      setScheduledOn("");
      refresh(session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Scheduling failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!session) return;
    setDeletingId(id);
    setError(null);
    try {
      await api.deleteRateChange(session.token, id);
      refresh(session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Retract failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleApplyDue() {
    if (!session) return;
    setApplying(true);
    setMessage(null);
    try {
      const applied = await api.applyDueRateChanges(session.token);
      setMessage(`Applied ${applied.length} rate change(s).`);
      refresh(session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8">
        <Card color="amber">
          <h1 className="mb-4 text-xl font-semibold text-primary">Schedule a Rate Change</h1>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Combobox
              options={items.map((item) => ({
                value: item.code,
                label: `${item.name} (current ₹${item.price_retail.toFixed(2)})`,
              }))}
              value={itemCode}
              onChange={setItemCode}
              placeholder="Type to search items..."
            />
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="New retail rate (₹)"
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                required
              />
              <input
                type="date"
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
                value={scheduledOn}
                onChange={(e) => setScheduledOn(e.target.value)}
                required
              />
            </div>

            {error && <p className="text-sm text-error">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Scheduling..." : "Schedule change"}
            </button>
          </form>
        </Card>

        <Card color="amber">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Scheduled changes</h2>
            <button
              onClick={handleApplyDue}
              disabled={applying}
              className="rounded-lg border border-primary px-3 py-1.5 text-sm text-primary disabled:opacity-50 "
            >
              {applying ? "Applying..." : "Apply due changes"}
            </button>
          </div>
          {message && <p className="mb-3 text-sm text-success">{message}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border ">
                  <th className="py-2 pr-4">Item</th>
                  <th className="py-2 pr-4">New rate</th>
                  <th className="py-2 pr-4">Effective</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id} className="border-b border-border ">
                    <td className="py-2 pr-4">{c.item_code}</td>
                    <td className="py-2 pr-4">₹{c.rate.toFixed(2)}</td>
                    <td className="py-2 pr-4">{c.scheduled_on}</td>
                    <td className="py-2 pr-4">{c.applied ? `Applied ${c.applied_at ?? ""}` : "Pending"}</td>
                    <td className="py-2 pr-4">
                      {!c.applied && (
                        <button
                          onClick={() => handleDelete(c.id)}
                          disabled={deletingId === c.id}
                          className="text-error hover:underline disabled:opacity-50 "
                        >
                          {deletingId === c.id ? "Retracting..." : "Retract"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {changes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-fg-muted">
                      No rate changes scheduled yet.
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
