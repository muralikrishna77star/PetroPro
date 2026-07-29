"use client";

import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  downloadAuthed,
  type Tenant,
  type Group,
  type Pump,
  type BackupFile,
  type Settings,
  type SettingKey,
} from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { Combobox } from "@/components/ui/Combobox";

export default function SettingsPage() {
  const session = useRequireSession(["super_admin", "owner"]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-8">
        {session && (
          <>
            <TenantSection token={session.token} />
            <PumpsSection token={session.token} />
            <OperationalFlagsSection token={session.token} editable={session.role === "super_admin"} />
            <FinYearSection token={session.token} />
            <BulkTaxSection token={session.token} />
            {session.role === "super_admin" && <BackupSection token={session.token} />}
            {session.role === "super_admin" && <GoLiveResetSection token={session.token} />}
          </>
        )}
      </div>
    </div>
  );
}

function PumpsSection({ token }: { token: string }) {
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.listPumps(token).then(setPumps).catch(() => undefined);
  }

  useEffect(refresh, [token]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createPump(token, { code, name });
      setCode("");
      setName("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create pump");
    }
  }

  async function handleSaveEdit(pumpCode: string) {
    setError(null);
    try {
      await api.updatePump(token, pumpCode, editingName);
      setEditingCode(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update pump");
    }
  }

  return (
    <Card color="teal">
      <h2 className="mb-1 text-lg font-semibold">Pumps</h2>
      <p className="mb-4 text-sm text-fg-muted">
        How many pumps this station has and what they&apos;re called — shown as a picker on the
        attendant and billing screens.
      </p>

      <form onSubmit={handleCreate} className="mb-4 flex gap-2">
        <input
          placeholder="Code"
          className="w-24 rounded-lg border border-border px-3 py-1.5 text-sm bg-bg-elevated"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <input
          placeholder="Name (e.g. Pump 1)"
          className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm bg-bg-elevated"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">Add</button>
      </form>
      {error && <p className="mb-3 text-sm text-error">{error}</p>}

      <ul className="flex flex-col gap-1 text-sm">
        {pumps.map((p) => (
          <li key={p.code} className="flex items-center gap-2 rounded-lg bg-card-hover px-3 py-1.5">
            <span className="w-16 font-mono">{p.code}</span>
            {editingCode === p.code ? (
              <>
                <input
                  className="flex-1 rounded border border-border px-2 py-1 text-sm bg-bg-elevated"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                />
                <button onClick={() => handleSaveEdit(p.code)} className="text-success">
                  Save
                </button>
                <button onClick={() => setEditingCode(null)} className="text-fg-muted">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">{p.name}</span>
                <button
                  onClick={() => {
                    setEditingCode(p.code);
                    setEditingName(p.name);
                  }}
                  className="text-fg-muted underline"
                >
                  Edit
                </button>
              </>
            )}
          </li>
        ))}
        {pumps.length === 0 && <li className="text-fg-muted">No pumps configured yet.</li>}
      </ul>
    </Card>
  );
}

function TenantSection({ token }: { token: string }) {
  const [profile, setProfile] = useState<Tenant>({
    name: "",
    address_line1: "",
    address_line2: "",
    tagline: "",
    gst_no: "",
    payment_qr_code: null,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getTenant(token).then(setProfile).catch(() => undefined);
  }, [token]);

  function handleQrFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProfile((p) => ({ ...p, payment_qr_code: reader.result as string }));
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      setProfile(await api.updateTenant(token, profile));
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card color="teal">
      <h1 className="mb-1 text-xl font-semibold text-primary">Tenant / Company Profile</h1>
      <p className="mb-4 text-sm text-fg-muted">Shown in the nav bar and on the letterhead of every printed invoice.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          placeholder="Company name"
          className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
          value={profile.name}
          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
          required
        />
        <input
          placeholder="Address line 1"
          className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
          value={profile.address_line1 ?? ""}
          onChange={(e) => setProfile({ ...profile, address_line1: e.target.value })}
        />
        <input
          placeholder="Address line 2"
          className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
          value={profile.address_line2 ?? ""}
          onChange={(e) => setProfile({ ...profile, address_line2: e.target.value })}
        />
        <input
          placeholder="Tagline (optional)"
          className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
          value={profile.tagline ?? ""}
          onChange={(e) => setProfile({ ...profile, tagline: e.target.value })}
        />
        <input
          placeholder="GSTIN"
          className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
          value={profile.gst_no ?? ""}
          onChange={(e) => setProfile({ ...profile, gst_no: e.target.value })}
        />

        <div className="rounded-lg border border-border p-3">
          <label className="mb-2 block text-sm font-medium">Payment QR Code</label>
          <p className="mb-3 text-xs text-fg-muted">
            Upload an image of the outlet&apos;s existing UPI/payment QR code — it&apos;s shown as-is
            on the attendant and billing/cashier screens when a customer pays by UPI. There&apos;s
            no payment gateway behind this; the attendant/cashier confirms receipt manually.
          </p>
          {profile.payment_qr_code && (
            // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL, not an optimizable remote image
            <img src={profile.payment_qr_code} alt="Payment QR code" className="mb-3 h-32 w-32 rounded-lg object-contain" />
          )}
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleQrFile(e.target.files?.[0])}
              className="text-sm"
            />
            {profile.payment_qr_code && (
              <button
                type="button"
                onClick={() => setProfile((p) => ({ ...p, payment_qr_code: null }))}
                className="text-sm text-error"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-error">{error}</p>}
        {message && <p className="text-sm text-success">{message}</p>}

        <button
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>
    </Card>
  );
}

const FLAG_LABELS: Record<SettingKey, { label: string; hint: string }> = {
  KEROSENE: { label: "Kerosene handling", hint: "Legacy key: KEROSENE" },
  FLEETCARDENTRY: { label: "Fleet-card entry", hint: "Legacy key: FLEETCARDENTRY" },
  PRINTTESTMODE: { label: "Print test mode", hint: "Legacy key: PRINTTESTMODE" },
  PRINTSPECIALCHARACTERS: { label: "Print special characters", hint: "Legacy key: PRINTSPECIALCHARACTERS" },
  BILLENTRY: { label: "Bill entry", hint: "Legacy key: BILLENTRY" },
  GSTNAMEADD: { label: "GST name on printout", hint: "Legacy key: GSTNAMEADD" },
  AUTOBACKUP: { label: "Automatic daily backups", hint: "Runs once a day on the server, keeps the last 14" },
  OFFLINEMODE: {
    label: "Allow offline billing",
    hint: "Staff can keep entering bills without connectivity — they queue on-device and sync automatically once back online",
  },
};

function OperationalFlagsSection({ token, editable }: { token: string; editable: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<SettingKey | null>(null);

  useEffect(() => {
    api.getSettings(token).then(setSettings).catch(() => undefined);
  }, [token]);

  async function toggle(key: SettingKey) {
    if (!settings) return;
    const next = settings[key] === "YES" ? "NO" : "YES";
    setError(null);
    setMessage(null);
    setSavingKey(key);
    try {
      setSettings(await api.updateSettings(token, { [key]: next }));
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Card color="teal">
      <h2 className="mb-1 text-lg font-semibold">Operational Settings</h2>
      <p className="mb-4 text-sm text-fg-muted">
        Legacy SETTINGS.DBF-style flags{editable ? "" : " (admin-only to change)"}.
      </p>
      {error && <p className="mb-2 text-sm text-error">{error}</p>}
      {message && <p className="mb-2 text-sm text-success">{message}</p>}
      <ul className="flex flex-col gap-2">
        {settings &&
          (Object.keys(FLAG_LABELS) as SettingKey[]).map((key) => (
            <li
              key={key}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm "
            >
              <div>
                <div className="font-medium">{FLAG_LABELS[key].label}</div>
                <div className="text-xs text-fg-muted">{FLAG_LABELS[key].hint}</div>
              </div>
              <button
                onClick={() => toggle(key)}
                disabled={!editable || savingKey === key}
                className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                  settings[key] === "YES"
                    ? "bg-success/15 text-success  "
                    : "bg-card-hover text-fg-muted bg-bg-elevated dark:text-zinc-400"
                }`}
              >
                {savingKey === key ? "..." : settings[key]}
              </button>
            </li>
          ))}
        {!settings && <li className="text-sm text-fg-muted">Loading...</li>}
      </ul>
    </Card>
  );
}

function FinYearSection({ token }: { token: string }) {
  const [finYearStart, setFinYearStart] = useState("");
  const [current, setCurrent] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getFinYear(token).then((r) => setCurrent(r.fin_year_start)).catch(() => undefined);
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const updated = await api.setFinYear(token, finYearStart);
      setCurrent(updated.fin_year_start);
      setFinYearStart("");
      setMessage("Financial year switched.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card color="teal">
      <h2 className="mb-1 text-lg font-semibold">Financial Year</h2>
      <p className="mb-4 text-sm text-fg-muted">Current: {current || "—"}</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="date"
          className="rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
          value={finYearStart}
          onChange={(e) => setFinYearStart(e.target.value)}
          required
        />
        <button
          disabled={saving}
          className="rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-50 "
        >
          {saving ? "Switching..." : "Switch"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}
    </Card>
  );
}

function BulkTaxSection({ token }: { token: string }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupCode, setGroupCode] = useState("");
  const [taxPercent, setTaxPercent] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listGroups(token).then(setGroups).catch(() => undefined);
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const updated = await api.bulkTaxChange(token, {
        tax_percent: Number(taxPercent),
        group_code: groupCode || undefined,
      });
      setMessage(`Updated tax rate on ${updated.length} item(s).`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Bulk update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card color="teal">
      <h2 className="mb-1 text-lg font-semibold">Bulk Tax Change</h2>
      <p className="mb-4 text-sm text-fg-muted">
        Revise the GST rate across a whole product group (or every item if no group is chosen).
      </p>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
        <Combobox
          options={groups.map((g) => ({ value: g.code, label: g.name }))}
          value={groupCode}
          onChange={setGroupCode}
          placeholder="All groups"
          className="w-40"
        />
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="New tax %"
          className="w-32 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
          value={taxPercent}
          onChange={(e) => setTaxPercent(e.target.value)}
          required
        />
        <button
          disabled={saving}
          className="rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-50 "
        >
          {saving ? "Applying..." : "Apply"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}
    </Card>
  );
}

function BackupSection({ token }: { token: string }) {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function handleDownload(filename: string) {
    setError(null);
    setDownloading(filename);
    try {
      await downloadAuthed(api.backupDownloadUrl(filename), token, filename);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }

  function refresh() {
    api.listBackups(token).then(setBackups).catch(() => undefined);
  }

  useEffect(refresh, [token]);

  async function handleCreate() {
    setError(null);
    setMessage(null);
    setWorking(true);
    try {
      await api.createBackup(token);
      setMessage("Backup created.");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Backup failed");
    } finally {
      setWorking(false);
    }
  }

  async function handleRestore(filename: string) {
    if (
      !window.confirm(
        `Restore "${filename}"? This overwrites the live database with this backup and cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    setWorking(true);
    try {
      await api.restoreBackup(token, filename);
      setMessage(`Restored from ${filename}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Restore failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card color="teal">
      <h2 className="mb-1 text-lg font-semibold">Backup &amp; Restore</h2>
      <p className="mb-4 text-sm text-fg-muted">
        Snapshots are stored on the server (admin-only) — download a copy to keep one off-server too.
        Restoring overwrites the live database. Automatic daily backups can be toggled below under
        Operational Settings.
      </p>
      <button
        onClick={handleCreate}
        disabled={working}
        className="mb-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {working ? "Working..." : "Create backup now"}
      </button>
      {error && <p className="mb-2 text-sm text-error">{error}</p>}
      {message && <p className="mb-2 text-sm text-success">{message}</p>}

      <ul className="flex flex-col gap-1 text-sm">
        {backups.map((b) => (
          <li key={b.filename} className="flex items-center justify-between rounded bg-card-hover px-3 py-2 bg-bg-elevated">
            <span>
              {b.filename} — {(b.sizeBytes / 1024).toFixed(0)} KB
            </span>
            <div className="flex gap-3">
              <button
                onClick={() => handleDownload(b.filename)}
                disabled={downloading === b.filename}
                className="text-fg-muted underline disabled:opacity-50"
              >
                {downloading === b.filename ? "Downloading..." : "Download"}
              </button>
              <button onClick={() => handleRestore(b.filename)} disabled={working} className="text-error disabled:opacity-50">
                Restore
              </button>
            </div>
          </li>
        ))}
        {backups.length === 0 && <li className="text-fg-muted">No backups yet.</li>}
      </ul>
    </Card>
  );
}

const RESET_CONFIRM_PHRASE = "RESET";

/** "Start using the app for real, from today" — wipes demo/reference transactional history
 *  (bills, stock movements, purchases, receipts, pending queue, shifts, audit log) while keeping
 *  everything already configured (catalog, customers, pumps, tenant identity, users). Auto-backs
 *  up first, so it's recoverable — but still needs a typed confirmation given how destructive it
 *  otherwise is. */
function GoLiveResetSection({ token }: { token: string }) {
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function handleReset() {
    if (confirmText !== RESET_CONFIRM_PHRASE) return;
    if (
      !window.confirm(
        "This clears all bills, stock movements, purchases, receipts, the pending queue, shifts and the audit log — permanently, though a backup is taken first. Catalog, customers, pumps and users are kept. Continue?",
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    setWorking(true);
    try {
      const summary = await api.resetTransactionalData(token);
      setMessage(
        `Done — backed up to ${summary.backup.filename} first. Financial year now starts ${summary.finYearStart}. Bill/purchase/receipt numbering restarts from 1.`,
      );
      setConfirmText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card color="error">
      <h2 className="mb-1 text-lg font-semibold text-error">Go-Live Reset</h2>
      <p className="mb-4 text-sm text-fg-muted">
        For switching from demo/reference data to real operation: clears every bill, stock
        movement, purchase, receipt, pending entry, shift and audit-log entry, resets customer
        dues to zero, and restarts bill/purchase/receipt numbering from 1. A backup is taken
        automatically first. Catalog, customers, pumps, tenant details and user accounts are{" "}
        <strong>not</strong> affected.
      </p>
      <label className="mb-1 block text-sm font-medium">
        Type <span className="font-mono">{RESET_CONFIRM_PHRASE}</span> to enable
      </label>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm bg-bg-elevated"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={RESET_CONFIRM_PHRASE}
        />
        <button
          onClick={handleReset}
          disabled={working || confirmText !== RESET_CONFIRM_PHRASE}
          className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-error/90 disabled:opacity-50"
        >
          {working ? "Resetting..." : "Reset to go live"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}
    </Card>
  );
}
