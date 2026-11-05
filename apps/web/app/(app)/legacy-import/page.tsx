"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { LegacyImportReport } from "@petropro/shared-types";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";

const KIND_LABELS = { sales: "Sales", stock: "Stock", purchases: "Purchases", receipts: "Receipts", mileage: "Mileage" } as const;

interface Entry {
  file: File;
  report: LegacyImportReport | null;
  error: string | null;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function statusOf({ report, error }: Entry, salesInBatch: boolean): { text: string; className: string } {
  if (error) return { text: error, className: "text-error" };
  if (!report) return { text: "Checking...", className: "text-fg-muted" };
  if (report.blocked) return { text: report.blocked, className: "text-error" };
  if (report.imported) return { text: "Imported", className: "text-success" };
  if (report.to_import === 0 && report.kind === "mileage" && salesInBatch) {
    return { text: "Checked again after the sales files import", className: "text-fg-muted" };
  }
  if (report.to_import === 0) return { text: "Nothing new to import", className: "text-fg-muted" };
  return { text: "Ready", className: "text-success" };
}

export default function LegacyImportPage() {
  const session = useRequireSession(["super_admin"]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;
  const token = session.token;

  function replaceEntry(index: number, change: Partial<Entry>) {
    setEntries((current) => current.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
  }

  async function chooseFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = [...list].sort((a, b) => a.name.localeCompare(b.name));
    // Mileage attaches to imported bills, so it stays last on screen and when importing.
    files.sort((a, b) => Number(/^mage/i.test(a.name)) - Number(/^mage/i.test(b.name)));
    setEntries(files.map((file) => ({ file, report: null, error: null })));
    setBackup(null);
    setError(null);
    setWorking(true);
    for (let i = 0; i < files.length; i++) {
      setProgress(`Checking ${files[i].name} (${i + 1} of ${files.length})`);
      try {
        replaceEntry(i, { report: await api.previewLegacyFile(token, files[i]) });
      } catch (err) {
        replaceEntry(i, { error: messageOf(err, "Could not check this file") });
      }
    }
    setProgress(null);
    setWorking(false);
  }

  const ready = entries.filter((e) => !e.error && e.report && !e.report.blocked && !e.report.imported && e.report.to_import > 0);

  // A mileage file may wait on sales files in this batch, so it goes along with them even if its
  // preview found nothing it could attach to yet. The server checks it again when it's imported.
  const otherReady = ready.filter((e) => e.report?.kind !== "mileage");
  const mileagePending = entries.filter((e) => !e.error && e.report?.kind === "mileage" && !e.report.blocked && !e.report.imported);
  const importable = otherReady.length > 0 ? [...otherReady, ...mileagePending] : ready;

  async function runImport() {
    if (
      !window.confirm(
        `Import ${importable.length} file(s) into PetroPro? A backup is taken first. New bills and receipts will use the next numbers, so your next live bill and receipt numbers will jump.`,
      )
    ) {
      return;
    }
    setError(null);
    setWorking(true);
    let needBackup = true;
    for (const entry of importable) {
      const index = entries.indexOf(entry);
      setProgress(`Importing ${entry.file.name}`);
      try {
        const report = await api.commitLegacyFile(token, entry.file, needBackup);
        replaceEntry(index, { report });
        if (report.backup) {
          setBackup(report.backup);
          needBackup = false;
        }
      } catch (err) {
        replaceEntry(index, { error: messageOf(err, "Could not import this file") });
        setError(`${entry.file.name} wasn't imported, and any files after it were not attempted. You can upload them again safely.`);
        break;
      }
    }
    setProgress(null);
    setWorking(false);
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-xl font-semibold text-primary">Legacy Import</h1>
          <p className="text-sm text-fg-muted">Bring in old Petbill (FoxPro) sales, stock, purchase, receipt and mileage files.</p>
        </div>

        <Card color="teal" className="flex flex-col gap-3">
          <ul className="list-disc pl-5 text-sm text-fg-muted">
            <li>
              <span className="font-mono">DECBIL25.DBF</span>: sales for one month
            </li>
            <li>
              <span className="font-mono">DECSTK25.DBF</span>: stock for one month
            </li>
            <li>
              <span className="font-mono">PURCH25.DBF</span>: purchases for calendar year 2025, picked up from the last
              purchase in PetroPro
            </li>
            <li>
              <span className="font-mono">RECPT26.DBF</span>: customer receipts for calendar year 2026
            </li>
            <li>
              <span className="font-mono">MAGE25.DBF</span>: mileage for financial year 2025-26 (April 2025 to March 2026). It attaches to
              bills imported here, so import those months&apos; sales first or in the same batch
            </li>
          </ul>
          <p className="text-sm text-fg-muted">
            Nothing changes until you press Import. Uploading a file again only adds what&apos;s new. Customer dues and
            stock balances aren&apos;t recalculated from these files.
          </p>
          <div>
            <label htmlFor="legacy-files" className="mb-1 block text-sm font-medium">
              Choose files
            </label>
            <input
              id="legacy-files"
              type="file"
              multiple
              accept=".dbf,.DBF"
              disabled={working}
              onChange={(e) => {
                void chooseFiles(e.target.files);
                e.target.value = "";
              }}
              className="max-w-full text-sm"
            />
          </div>
        </Card>

        {progress && (
          <p role="status" className="text-sm text-fg-muted">
            {progress}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {backup && (
          <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            Backup taken before importing: <span className="break-all font-mono">{backup}</span>. You can restore it from
            Settings.
          </p>
        )}

        {entries.length > 0 && (
          <Card color="teal" className="flex flex-col gap-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4">File</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Period</th>
                    <th className="py-2 pr-4 text-right">{entries.some((e) => e.report?.imported) ? "Imported" : "To import"}</th>
                    <th className="py-2 pr-4 text-right">Already in PetroPro</th>
                    <th className="py-2 pr-4 text-right">Not imported</th>
                    <th className="py-2 pr-4 text-right">Amount</th>
                    <th className="py-2 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const { report } = entry;
                    const status = statusOf(entry, otherReady.some((e) => e.report?.kind === "sales"));
                    const notImported = report?.skipped.reduce((sum, s) => sum + s.count, 0) ?? 0;
                    return (
                      <tr key={entry.file.name} className="border-b border-border align-top">
                        <td className="py-2 pr-4 font-mono">{entry.file.name}</td>
                        <td className="py-2 pr-4">{report?.kind ? KIND_LABELS[report.kind] : "—"}</td>
                        <td className="whitespace-nowrap py-2 pr-4">{report?.period ?? "—"}</td>
                        <td className="py-2 pr-4 text-right">{report && !report.blocked ? report.to_import : "—"}</td>
                        <td className="py-2 pr-4 text-right">{report && !report.blocked ? report.already_present : "—"}</td>
                        <td className={`py-2 pr-4 text-right ${notImported > 0 ? "text-error" : ""}`}>
                          {report && !report.blocked ? notImported : "—"}
                        </td>
                        <td className="py-2 pr-4 text-right">{report?.to_import_amount ? report.to_import_amount.toFixed(2) : "—"}</td>
                        <td className={`min-w-40 py-2 pr-4 ${status.className}`}>{status.text}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {entries.some((e) => e.report && !e.report.blocked && (e.report.skipped.length > 0 || e.report.notes.length > 0)) && (
              <div className="flex flex-col gap-3">
                {entries.map(({ file, report }) =>
                  report && !report.blocked && (report.skipped.length > 0 || report.notes.length > 0) ? (
                    <div key={file.name} className="rounded-lg border border-border p-3 text-sm">
                      <p className="mb-1 font-mono font-medium">{file.name}</p>
                      <ul className="flex flex-col gap-1">
                        {report.skipped.map((skip) => (
                          <li key={skip.reason} className="break-words text-error">
                            {skip.reason}: {skip.count}
                            {skip.examples.length > 0 && <span className="text-fg-muted"> ({skip.examples.join(", ")})</span>}
                          </li>
                        ))}
                        {report.notes.map((note) => (
                          <li key={note} className="text-fg-muted">
                            {note}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
                {entries.some((e) => e.report?.skipped.some((s) => /Catalog|Customers/.test(s.reason))) && (
                  <p className="text-xs text-fg-muted">
                    To bring in bills or rows held back for a missing code, add it to the Catalog or Customers, then upload
                    the same file again. Only what&apos;s missing gets added.
                  </p>
                )}
              </div>
            )}

            <div>
              <button
                onClick={runImport}
                disabled={working || importable.length === 0}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {working ? "Working..." : importable.length > 0 ? `Import ${importable.length} file(s)` : "Nothing to import"}
              </button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
