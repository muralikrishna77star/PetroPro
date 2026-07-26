"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Shift } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";

export default function ShiftsPage() {
  const session = useRequireSession(["super_admin", "owner", "operator", "field_operator"]);
  const [current, setCurrent] = useState<Shift | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);

  const canViewAll = session?.role === "super_admin" || session?.role === "owner";

  const refresh = useCallback(
    (token: string) => {
      api.getCurrentShift(token).then(setCurrent).catch(() => undefined);
      if (canViewAll) api.listShifts(token).then(setAllShifts).catch(() => undefined);
    },
    [canViewAll],
  );

  useEffect(() => {
    if (!session) return;
    refresh(session.token);
  }, [session, refresh]);

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.openShift(session.token, Number(openingCash));
      setOpeningCash("");
      refresh(session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open shift");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !current) return;
    setError(null);
    setSubmitting(true);
    try {
      const closed = await api.closeShift(session.token, current.id, {
        closing_cash: Number(closingCash),
        notes: notes || undefined,
      });
      setCurrent(closed);
      setClosingCash("");
      setNotes("");
      refresh(session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not close shift");
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8">
        <Card color="zinc">
          <h1 className="mb-4 text-xl font-semibold text-primary">My Shift</h1>

          {!current || current.status === "closed" ? (
            <form onSubmit={handleOpen} className="flex flex-col gap-3">
              {current?.status === "closed" && (
                <div className="rounded-lg border border-border p-3 text-sm ">
                  <p>Last shift closed at {current.closed_at}.</p>
                  <p>
                    Expected ₹{current.expected_cash?.toFixed(2)} · Actual ₹{current.closing_cash?.toFixed(2)} ·
                    Variance{" "}
                    <span className={current.variance && current.variance !== 0 ? "text-error" : "text-success"}>
                      ₹{current.variance?.toFixed(2)}
                    </span>
                  </p>
                </div>
              )}
              <label className="text-sm font-medium">Opening cash</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                required
              />
              {error && <p className="text-sm text-error">{error}</p>}
              <button
                disabled={submitting}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "Opening..." : "Open shift"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleClose} className="flex flex-col gap-3">
              <div className="rounded-lg border border-border p-3 text-sm ">
                <p>Shift #{current.id} opened at {current.opened_at}</p>
                <p>Opening cash: ₹{current.opening_cash.toFixed(2)}</p>
              </div>
              <label className="text-sm font-medium">Closing cash (counted)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                required
              />
              <input
                placeholder="Notes (optional)"
                className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              {error && <p className="text-sm text-error">{error}</p>}
              <button
                disabled={submitting}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "Closing..." : "Close shift"}
              </button>
            </form>
          )}
        </Card>

        {canViewAll && (
          <Card color="zinc">
            <h2 className="mb-4 text-lg font-semibold">All shifts</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border ">
                    <th className="py-2 pr-4">User</th>
                    <th className="py-2 pr-4">Opened</th>
                    <th className="py-2 pr-4">Closed</th>
                    <th className="py-2 pr-4">Opening</th>
                    <th className="py-2 pr-4">Closing</th>
                    <th className="py-2 pr-4">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {allShifts.map((s) => (
                    <tr key={s.id} className="border-b border-border ">
                      <td className="py-2 pr-4">{s.user_id}</td>
                      <td className="py-2 pr-4">{s.opened_at}</td>
                      <td className="py-2 pr-4">{s.closed_at ?? "—"}</td>
                      <td className="py-2 pr-4">₹{s.opening_cash.toFixed(2)}</td>
                      <td className="py-2 pr-4">{s.closing_cash !== null ? `₹${s.closing_cash.toFixed(2)}` : "—"}</td>
                      <td className="py-2 pr-4">{s.variance !== null ? `₹${s.variance.toFixed(2)}` : "—"}</td>
                    </tr>
                  ))}
                  {allShifts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-fg-muted">
                        No shifts yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
