"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type CloseDaySettings, type CloseDaySummary } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { CloseDayDialog } from "@/components/CloseDayDialog";
import { SectionLabel } from "@/components/SectionLabel";

/** Utilities → Close Day. Closes the running billing date for the whole station (deliberately
 *  not on the Billing screen, so a cashier can't close the day by accident mid-sale), and holds
 *  the two settings that govern it. */
export default function CloseDayPage() {
  const session = useRequireSession(["super_admin", "owner", "operator"]);
  const [summary, setSummary] = useState<CloseDaySummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dialogSummary, setDialogSummary] = useState<CloseDaySummary | null>(null);
  const [dayClosed, setDayClosed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return null;
    try {
      const next = await api.getCloseDaySummary(session.token);
      setSummary(next);
      setLoadError(null);
      return next;
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load the billing date");
      return null;
    }
  }, [session]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the API, an external system
    void refresh();
  }, [refresh]);

  // Fresh figures every time the dialog opens, so it never confirms on stale sales.
  async function openDialog() {
    setCloseError(null);
    setDayClosed(false);
    const latest = await refresh();
    if (latest) setDialogSummary(latest);
  }

  async function confirmClose() {
    if (!session) return;
    setClosing(true);
    setCloseError(null);
    try {
      const result = await api.closeDay(session.token);
      setDialogSummary(result.summary);
      setDayClosed(true);
    } catch (err) {
      setCloseError(err instanceof ApiError ? err.message : "Failed to close the day");
    } finally {
      setClosing(false);
    }
  }

  function dismissDialog() {
    setDialogSummary(null);
    setDayClosed(false);
    setCloseError(null);
    void refresh();
  }

  if (!session) return null;
  const canEditSettings = session.role === "super_admin" || session.role === "owner";

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-semibold text-primary">Close Day</h1>

        <Card color="teal" className="flex flex-col gap-3">
          <SectionLabel>Billing Date</SectionLabel>
          {loadError && <p className="text-sm text-error">{loadError}</p>}
          {summary && (
            <>
              <p className="text-sm">
                Bills are posting to <span className="font-semibold">{summary.date}</span>
                <span className="text-fg-muted">
                  {" "}
                  · {summary.day.bill_count} bill{summary.day.bill_count === 1 ? "" : "s"} so far
                </span>
              </p>
              <p className="text-sm text-fg-muted">
                After closing, billing{" "}
                {summary.next_date_open_now
                  ? `moves straight on to ${summary.next_date}.`
                  : `stays shut until ${summary.next_date} opens at ${summary.next_date_opens_at}.`}
              </p>
              {!summary.can_close && summary.close_blocked_reason && (
                <p className="text-sm font-medium text-warning">{summary.close_blocked_reason}</p>
              )}
              <div>
                <button
                  onClick={openDialog}
                  disabled={!summary.can_close}
                  title="Shows the day's sales and asks you to confirm before closing"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  Close Day…
                </button>
              </div>
            </>
          )}
        </Card>

        <CloseDaySettingsCard token={session.token} editable={canEditSettings} onSaved={() => void refresh()} />

        {dialogSummary && (
          <CloseDayDialog
            summary={dialogSummary}
            closed={dayClosed}
            closing={closing}
            error={closeError}
            onConfirm={confirmClose}
            onClose={dismissDialog}
          />
        )}
      </div>
    </div>
  );
}

function CloseDaySettingsCard({
  token,
  editable,
  onSaved,
}: {
  token: string;
  editable: boolean;
  onSaved: () => void;
}) {
  const [minTime, setMinTime] = useState("");
  const [nextDate, setNextDate] = useState<CloseDaySettings["next_date"]>("wait");
  const [changeover, setChangeover] = useState("05:30");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCloseDaySettings(token)
      .then((s) => {
        setMinTime(s.min_close_time ?? "");
        setNextDate(s.next_date);
        setChangeover(s.day_changeover_time);
      })
      .catch(() => undefined);
  }, [token]);

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await api.updateCloseDaySettings(token, {
        min_close_time: minTime || null,
        next_date: nextDate,
        day_changeover_time: changeover,
      });
      setMinTime(saved.min_close_time ?? "");
      setNextDate(saved.next_date);
      setChangeover(saved.day_changeover_time);
      setMessage("Saved.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card color="zinc" className="flex flex-col gap-4">
      <SectionLabel>Close Day Settings</SectionLabel>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Minimum time to close the day</span>
        <span className="text-xs text-fg-muted">
          The billing date can&apos;t be closed on the day itself before this time. Leave empty to allow closing at any
          time. A date left open from an earlier day can always be closed.
        </span>
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={minTime}
            disabled={!editable}
            onChange={(e) => setMinTime(e.target.value)}
            className="w-36 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm disabled:opacity-60"
          />
          {editable && minTime && (
            <button onClick={() => setMinTime("")} className="text-sm text-fg-muted hover:underline">
              Any time
            </button>
          )}
        </div>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">After closing today&apos;s date, bills go to</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="next-date"
            className="mt-0.5"
            checked={nextDate === "tomorrow"}
            disabled={!editable}
            onChange={() => setNextDate("tomorrow")}
          />
          <span>
            Tomorrow&apos;s date, straight away
            <span className="block text-xs text-fg-muted">Bills keyed in later tonight count for tomorrow.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="next-date"
            className="mt-0.5"
            checked={nextDate === "wait"}
            disabled={!editable}
            onChange={() => setNextDate("wait")}
          />
          <span>
            Today&apos;s date stays closed until the date changes
            <span className="block text-xs text-fg-muted">
              No billing until tomorrow&apos;s date opens at the change-over time below.
            </span>
          </span>
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Date changes over at</span>
        <span className="text-xs text-fg-muted">
          When a new billing date begins. With &ldquo;stays closed&rdquo; above, the next date opens for billing at this
          time; a date also can&apos;t be closed before it has begun. 05:30 (midnight UTC) is how PetroPro has always
          worked.
        </span>
        <input
          type="time"
          required
          value={changeover}
          disabled={!editable}
          onChange={(e) => setChangeover(e.target.value)}
          className="w-36 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm disabled:opacity-60"
        />
      </label>

      {error && <p className="text-sm text-error">{error}</p>}
      {message && <p className="text-sm text-success">{message}</p>}
      {editable ? (
        <div>
          <button
            onClick={save}
            disabled={saving || !changeover}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">Only an Owner or Super Admin can change these.</p>
      )}
    </Card>
  );
}
