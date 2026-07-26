"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadAuthed, type Item, type Pump, type SettleResponse, type Tenant } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { Combobox } from "@/components/ui/Combobox";
import { PaymentQrPanel } from "@/components/PaymentQrPanel";
import { queueEntry, getQueuedEntries, flushQueue } from "@/lib/offlineQueue";
import { printReferenceSlip } from "@/lib/printSlip";

type Mode = "queue" | "settle";
type SettlePaymentType = "cash" | "upi" | "card";

const SETTLE_PAYMENT_LABELS: Record<SettlePaymentType, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
};

interface LastEntry {
  vehicleNo: string;
  itemName: string;
  qty: number;
  rate: number;
  time: string;
}

function printPumpSlip(entry: LastEntry, tenantName: string) {
  printReferenceSlip({
    tenantName,
    heading: "PUMP SLIP — not a tax invoice",
    vehicleNo: entry.vehicleNo,
    lines: [{ itemName: entry.itemName, qty: entry.qty, rate: entry.rate }],
    time: entry.time,
    footer: "Pay at cashier to receive invoice",
  });
}

export default function AttendantPage() {
  const session = useRequireSession(["super_admin", "owner", "field_operator"]);
  const [items, setItems] = useState<Item[]>([]);
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [mode, setMode] = useState<Mode>("queue");
  const [settlePaymentType, setSettlePaymentType] = useState<SettlePaymentType>("cash");
  const [upiConfirmed, setUpiConfirmed] = useState(false);
  const [vehicleNo, setVehicleNo] = useState("");
  const [pumpCode, setPumpCode] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [qty, setQty] = useState("");
  const [odometer, setOdometer] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [lastEntry, setLastEntry] = useState<LastEntry | null>(null);
  const [settledInvoice, setSettledInvoice] = useState<SettleResponse | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const tenantName = tenant?.name ?? "PetroPro";
  const [submitting, setSubmitting] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshQueuedCount = useCallback(() => {
    getQueuedEntries()
      .then((entries) => setQueuedCount(entries.length))
      .catch(() => undefined);
  }, []);

  const sync = useCallback(async () => {
    if (!session) return;
    setSyncing(true);
    try {
      await flushQueue(session.token);
    } finally {
      setSyncing(false);
      refreshQueuedCount();
    }
  }, [session, refreshQueuedCount]);

  useEffect(() => {
    if (!session) return;
    api
      .listItems(session.token)
      .then((data) => {
        setItems(data);
        if (data.length > 0) setItemCode(data[0].code);
      })
      .catch(() => setMessage({ kind: "error", text: "Could not load items" }));
    api.listPumps(session.token).then(setPumps).catch(() => undefined);
    api.getTenant(session.token).then(setTenant).catch(() => undefined);

    refreshQueuedCount();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing against the network, an external system
    sync();

    window.addEventListener("online", sync);
    const interval = setInterval(sync, 20_000);
    return () => {
      window.removeEventListener("online", sync);
      clearInterval(interval);
    };
  }, [session, sync, refreshQueuedCount]);

  function selectMode(next: Mode) {
    setMode(next);
    setMessage(null);
    setLastEntry(null);
    setSettledInvoice(null);
    setUpiConfirmed(false);
  }

  function selectSettlePaymentType(next: SettlePaymentType) {
    setSettlePaymentType(next);
    setUpiConfirmed(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (mode === "settle" && settlePaymentType === "upi" && !upiConfirmed) return;
    setMessage(null);
    setSettledInvoice(null);
    setSubmitting(true);

    const vehicle = vehicleNo.trim().toUpperCase();
    const qtyNum = qty ? Number(qty) : undefined;
    const odometerNum = odometer ? Number(odometer) : undefined;
    const item = items.find((i) => i.code === itemCode);

    if (mode === "settle") {
      try {
        const result = await api.createWalkInBill(session.token, {
          paymentType: settlePaymentType,
          vehicleNo: vehicle,
          pumpCode: pumpCode || undefined,
          lines: [{ item_code: itemCode, qty: qtyNum ?? 0, odometer: odometerNum }],
        });
        setSettledInvoice(result);
        setMessage({ kind: "ok", text: `Bill #${result.bill.bill_no} settled — ₹${result.bill.grand_total.toFixed(2)}` });
        setVehicleNo("");
        setQty("");
        setOdometer("");
        setUpiConfirmed(false);
      } catch (err) {
        setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Could not settle bill — check connectivity and try again, or switch to “Send to cashier”" });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const clientRef = crypto.randomUUID();
    const entry = {
      vehicle_no: vehicle,
      item_code: itemCode,
      qty: qtyNum,
      odometer: odometerNum,
      pump_code: pumpCode || undefined,
    };
    const newLastEntry: LastEntry | null =
      item && entry.qty
        ? {
            vehicleNo: entry.vehicle_no,
            itemName: item.name,
            qty: entry.qty,
            rate: item.price_retail,
            time: new Date().toLocaleTimeString(),
          }
        : null;

    try {
      await api.createPendingTransaction(session.token, { ...entry, client_ref: clientRef });
      setMessage({ kind: "ok", text: `Sent to cashier queue: ${entry.vehicle_no}` });
      setLastEntry(newLastEntry);
      setVehicleNo("");
      setQty("");
      setOdometer("");
    } catch (err) {
      if (err instanceof ApiError) {
        setMessage({ kind: "error", text: err.message });
      } else {
        // Network unreachable (offline) rather than a rejected request — queue it locally.
        await queueEntry({ ...entry, clientRef, queuedAt: new Date().toISOString() });
        setMessage({ kind: "ok", text: `Offline — queued for ${entry.vehicle_no}, will sync automatically` });
        setLastEntry(newLastEntry);
        setVehicleNo("");
        setQty("");
        setOdometer("");
        refreshQueuedCount();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-primary">Attendant Entry</h1>
          {queuedCount > 0 && (
            <button
              onClick={sync}
              disabled={syncing}
              className="rounded-full border border-warning px-3 py-1 text-xs text-warning disabled:opacity-50 "
            >
              {syncing ? "Syncing..." : `${queuedCount} queued — sync now`}
            </button>
          )}
        </div>

        <div className="mb-4 flex gap-1 rounded-lg border border-border p-1">
          <button
            type="button"
            onClick={() => selectMode("queue")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "queue" ? "bg-primary text-white" : "text-fg-muted hover:bg-card-hover"
            }`}
          >
            Send to cashier
          </button>
          <button
            type="button"
            onClick={() => selectMode("settle")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "settle" ? "bg-primary text-white" : "text-fg-muted hover:bg-card-hover"
            }`}
          >
            Settle now
          </button>
        </div>

        <Card color="orange" as="form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Vehicle number</label>
            <input
              className="w-full rounded-lg border border-border px-3 py-2 text-sm uppercase  bg-bg-elevated"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="KA01AB1234"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Pump (optional)</label>
            <Combobox
              options={pumps.map((p) => ({ value: p.code, label: p.name }))}
              value={pumpCode}
              onChange={setPumpCode}
              placeholder="Select pump..."
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Fuel / item</label>
            <Combobox
              options={items.map((item) => ({ value: item.code, label: item.name }))}
              value={itemCode}
              onChange={setItemCode}
              placeholder="Type to search items..."
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Quantity (litres)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Odometer (optional)</label>
            <input
              type="number"
              min="0"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
            />
          </div>

          {mode === "settle" && (
            <div>
              <label className="mb-1 block text-sm font-medium">Payment</label>
              <div className="flex gap-1 rounded-lg border border-border p-1">
                {(["cash", "upi", "card"] as SettlePaymentType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => selectSettlePaymentType(type)}
                    className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                      settlePaymentType === type ? "bg-primary text-white" : "text-fg-muted hover:bg-card-hover"
                    }`}
                  >
                    {SETTLE_PAYMENT_LABELS[type]}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                Credit sales aren&apos;t available here — use the cashier/billing screen for those.
              </p>
              {settlePaymentType === "upi" && (
                <PaymentQrPanel
                  qrCode={tenant?.payment_qr_code ?? null}
                  confirmed={upiConfirmed}
                  onConfirmChange={setUpiConfirmed}
                />
              )}
            </div>
          )}

          {message && (
            <div className={`text-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}>
              <p>{message.text}</p>
              {message.kind === "ok" && mode === "queue" && lastEntry && (
                <button
                  type="button"
                  onClick={() => printPumpSlip(lastEntry, tenantName)}
                  className="mt-2 rounded-lg border border-success px-3 py-1.5 text-sm text-success"
                >
                  Print pump slip
                </button>
              )}
              {message.kind === "ok" && mode === "settle" && settledInvoice && (
                <button
                  type="button"
                  onClick={() =>
                    downloadAuthed(
                      api.invoicePdfUrl(settledInvoice.bill.bill_no),
                      session.token,
                      `invoice-${settledInvoice.bill.bill_no}.pdf`,
                      "open",
                    )
                  }
                  className="mt-2 rounded-lg border border-success px-3 py-1.5 text-sm text-success"
                >
                  Print Bill
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || (mode === "settle" && settlePaymentType === "upi" && !upiConfirmed)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Sending..." : mode === "settle" ? "Settle & print" : "Send to cashier"}
          </button>
        </Card>
      </div>
    </div>
  );
}
