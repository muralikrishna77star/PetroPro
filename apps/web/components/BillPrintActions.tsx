"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PrintJob, PrintPayload } from "@petropro/shared-types";
import { api, ApiError, downloadAuthed } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { deliver, findFailedForBill, flushPrintReports, forgetFailed, getTerminalId, jobKeyOf, rememberFailed, reportJob } from "@/lib/printing";
import { Button } from "@/components/ui/Button";
import { ReceiptPreview } from "@/components/ReceiptPreview";

type Status = { kind: "idle" } | { kind: "working" } | { kind: "sent"; text: string } | { kind: "failed"; text: string };

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "PetroPro can't be reached right now. The bill is saved. Try printing again once you're back online.";
  // Cancelling a browser's device picker isn't a printer fault, but it did stop the print.
  if (err instanceof DOMException && err.name === "NotFoundError") return "No printer was chosen.";
  return err instanceof Error ? err.message : fallback;
}

/**
 * Print, reprint, preview and PDF for one saved bill. Everything here happens after the bill is final,
 * and the API only records paper against it, so no outcome on this screen can lose or repeat a sale.
 */
export function BillPrintActions({
  billNo,
  token,
  justFinalized = false,
  autoPrint = false,
}: {
  billNo: number;
  token: string;
  /** Lets this terminal's "auto-print after finalizing" setting apply. */
  justFinalized?: boolean;
  /** The cashier asked for it, with Save and Print. */
  autoPrint?: boolean;
}) {
  const [jobs, setJobs] = useState<PrintJob[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [failedJob, setFailedJob] = useState<number | null>(null);
  const [preview, setPreview] = useState<PrintPayload | null>(null);
  const busy = useRef(false);

  const role = getSession()?.role;
  const canConfigure = role === "super_admin" || role === "owner";
  const printed = jobs?.some((j) => j.status === "sent") ?? false;

  const refreshJobs = useCallback(() => {
    api
      .listBillPrintJobs(token, billNo)
      .then((list) => {
        setJobs(list);
        const unfinished = list.find((j) => j.kind === "original" && j.status === "failed");
        if (unfinished) setFailedJob(unfinished.id);
      })
      .catch(() => setJobs((current) => current ?? []));
  }, [billNo, token]);

  const send = useCallback(
    async (payload: PrintPayload) => {
      const job = payload.job!;
      try {
        await deliver(payload, jobKeyOf(job.id));
        forgetFailed(job.id);
        await reportJob(token, { job_id: job.id, status: "sent", error: null });
        setFailedJob(null);
        setStatus({
          kind: "sent",
          text:
            payload.settings.connection === "browser"
              ? "Sent to the print dialog. Check the printer."
              : `Sent to the printer${job.kind === "duplicate" ? " as a duplicate" : ""}.`,
        });
      } catch (err) {
        const text = errorText(err, "The printer didn't take this receipt.");
        rememberFailed(payload);
        await reportJob(token, { job_id: job.id, status: "failed", error: text });
        setFailedJob(job.id);
        setStatus({ kind: "failed", text: `${text} The bill is saved and nothing was charged twice.` });
      }
      refreshJobs();
    },
    [refreshJobs, token],
  );

  const print = useCallback(
    async (requestKey: string) => {
      if (busy.current) return;
      busy.current = true;
      setStatus({ kind: "working" });
      try {
        await flushPrintReports(token);
        const payload = await api.requestPrint(token, billNo, { request_key: requestKey, terminal_id: getTerminalId() });
        // The same request again, such as a remounted screen, must not print it twice.
        if (payload.job?.status === "sent") setStatus({ kind: "sent", text: "Already printed." });
        else await send(payload);
      } catch (err) {
        setStatus({ kind: "failed", text: errorText(err, "This couldn't be printed.") });
      } finally {
        busy.current = false;
      }
    },
    [billNo, send, token],
  );

  async function retry(viaBrowser: boolean) {
    if (busy.current || failedJob === null) return;
    busy.current = true;
    setStatus({ kind: "working" });
    try {
      let payload: PrintPayload;
      try {
        payload = await api.retryPrintJob(token, failedJob, { terminal_id: getTerminalId(), connection: viaBrowser ? "browser" : undefined });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const cached = findFailedForBill(billNo);
        if (!cached) throw err;
        payload = cached;
      }
      await send(viaBrowser ? { ...payload, settings: { ...payload.settings, connection: "browser" } } : payload);
    } catch (err) {
      setStatus({ kind: "failed", text: errorText(err, "This couldn't be printed.") });
      refreshJobs();
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    if (!justFinalized && !autoPrint) return;
    let cancelled = false;
    const guard = `petropro.print.auto.${billNo}`;
    const start = async () => {
      if (sessionStorage.getItem(guard)) return;
      const wanted = autoPrint || (await api.getTerminalPrinter(token, getTerminalId()).then((s) => s.auto_print, () => false));
      if (!wanted || cancelled || sessionStorage.getItem(guard)) return;
      sessionStorage.setItem(guard, "1");
      // A fixed key, so this can only ever become one job however often the screen is drawn.
      await print(`auto-${billNo}-${getTerminalId()}`);
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [autoPrint, billNo, justFinalized, print, token]);

  function printOrReprint() {
    if (printed && !window.confirm(`Bill ${billNo} has already been printed. Print a copy marked DUPLICATE BILL? This doesn't create another sale.`)) return;
    void print(crypto.randomUUID());
  }

  async function showPreview() {
    setStatus({ kind: "idle" });
    try {
      setPreview(await api.previewReceipt(token, billNo, getTerminalId()));
    } catch (err) {
      setStatus({ kind: "failed", text: errorText(err, "The preview couldn't be loaded.") });
    }
  }

  async function downloadPdf() {
    try {
      await downloadAuthed(api.billReceiptPdfUrl(billNo, getTerminalId()), token, `receipt-${billNo}.pdf`);
    } catch (err) {
      setStatus({ kind: "failed", text: errorText(err, "The PDF couldn't be downloaded.") });
    }
  }

  const working = status.kind === "working";

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={printOrReprint} disabled={working || jobs === null}>
          {working ? "Printing..." : printed ? "Reprint Bill" : "Print Bill"}
        </Button>
        <Button size="sm" variant="outline" onClick={showPreview}>
          Print Preview
        </Button>
        <Button size="sm" variant="outline" onClick={downloadPdf}>
          Download PDF
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadAuthed(api.invoicePdfUrl(billNo), token, `invoice-${billNo}.pdf`, "open").catch(() => setStatus({ kind: "failed", text: "The invoice couldn't be opened." }))}
        >
          A5 Invoice
        </Button>
        {canConfigure && (
          <Link href="/printer-settings" className="text-sm text-fg-muted underline">
            Printer Settings
          </Link>
        )}
      </div>

      {status.kind === "sent" && (
        <p role="status" className="text-sm text-success">
          {status.text}
        </p>
      )}
      {status.kind === "failed" && (
        <p role="alert" className="text-sm text-error">
          {status.text}
        </p>
      )}
      {failedJob !== null && !working && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => retry(false)}>
            Retry
          </Button>
          <Button size="sm" variant="outline" onClick={() => retry(true)}>
            Print from browser instead
          </Button>
        </div>
      )}

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview of bill ${billNo}`}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
          onClick={() => setPreview(null)}
        >
          <div className="my-4 flex max-w-full flex-col gap-3 rounded-2xl border border-border bg-bg p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <ReceiptPreview payload={preview} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setPreview(null)} autoFocus>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
