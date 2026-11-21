"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { deliver, getTerminalId, jobKeyOf, reportJob } from "@/lib/printing";

/** Printer Settings announces a save, so turning the station on or off takes effect at once. */
export const PRINT_SETTINGS_CHANGED = "petropro-print-settings-changed";
const RETRY_AFTER_ERROR_MS = 5_000;

type Last = { ok: boolean; text: string; at: number } | null;

function reason(err: unknown): string {
  return err instanceof Error ? err.message : "The printer didn't take it.";
}

/**
 * Makes this computer a print station while any PetroPro page is open on it: it asks the server for
 * bills other devices sent here, prints each on this computer's own printer, and reports the
 * outcome, which the device that sent it shows. The server hands each job to one window only, so
 * two open tabs can't print it twice. Renders nothing unless this terminal is a print station.
 */
export function PrintStationRunner() {
  const [isStation, setIsStation] = useState(false);
  const [last, setLast] = useState<Last>(null);
  const [printed, setPrinted] = useState(0);

  // Is this terminal a print station? Asked on load and whenever Printer Settings saves.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      const token = getSession()?.token;
      if (!token) return;
      api
        .getTerminalPrinter(token, getTerminalId())
        .then((s) => !cancelled && setIsStation(s.print_station))
        .catch(() => undefined);
    };
    check();
    window.addEventListener(PRINT_SETTINGS_CHANGED, check);
    return () => {
      cancelled = true;
      window.removeEventListener(PRINT_SETTINGS_CHANGED, check);
    };
  }, []);

  useEffect(() => {
    if (!isStation) return;
    let active = true;
    const stationId = getTerminalId();

    async function loop() {
      while (active) {
        const token = getSession()?.token;
        if (!token) return;
        try {
          const work = await api.takeStationWork(token, stationId);
          if (!active) return;
          if (work.kind === "job") {
            const job = work.payload.job!;
            try {
              await deliver(work.payload, jobKeyOf(job.id));
              await reportJob(token, { job_id: job.id, status: "sent", error: null });
              setPrinted((n) => n + 1);
              setLast({ ok: true, text: `Printed bill ${job.bill_no}${job.kind === "duplicate" ? " (duplicate)" : ""}`, at: Date.now() });
            } catch (err) {
              await reportJob(token, { job_id: job.id, status: "failed", error: reason(err) });
              setLast({ ok: false, text: `Couldn't print bill ${job.bill_no}: ${reason(err)}`, at: Date.now() });
            }
          } else if (work.kind === "test") {
            try {
              await deliver(work.payload, null);
              await api.reportStationTest(token, work.test_id, "sent", null);
              setLast({ ok: true, text: `Printed a test page for ${work.requested_by}`, at: Date.now() });
            } catch (err) {
              await api.reportStationTest(token, work.test_id, "failed", reason(err)).catch(() => undefined);
              setLast({ ok: false, text: `Couldn't print a test page: ${reason(err)}`, at: Date.now() });
            }
          }
        } catch (err) {
          // Turned off elsewhere: stop. Offline or a server hiccup: try again shortly.
          if (err instanceof ApiError && err.status === 409) {
            setIsStation(false);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_ERROR_MS));
        }
      }
    }
    void loop();
    return () => {
      active = false;
    };
  }, [isStation]);

  if (!isStation) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      title={last ? new Date(last.at).toLocaleTimeString() : undefined}
      className={`fixed bottom-3 right-3 z-40 flex max-w-[min(26rem,calc(100vw-1.5rem))] items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-lg print:hidden ${
        last && !last.ok ? "border-error/50 bg-bg-elevated text-error" : "border-border bg-bg-elevated text-fg-muted"
      }`}
    >
      <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className={`h-2 w-2 shrink-0 rounded-full ${last && !last.ok ? "bg-error" : "bg-success"}`} aria-hidden="true" />
      <span className="truncate">
        {last ? last.text : "Print station: printing bills sent from other devices"}
        {printed > 0 && last?.ok ? ` · ${printed} printed` : ""}
      </span>
    </div>
  );
}
