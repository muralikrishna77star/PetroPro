"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  downloadAuthed,
  type Bill,
  type Customer,
  type Item,
  type Order,
  type OrderLine,
  type Pump,
  type SettleResponse,
  type Tenant,
} from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { Combobox } from "@/components/ui/Combobox";
import { PaymentQrPanel } from "@/components/PaymentQrPanel";
import { deleteDraft, listDrafts, saveDraft, type BillingDraft, type BillingDraftLine } from "@/lib/billingDrafts";
import { queueBill, getQueuedBills, flushBillQueue } from "@/lib/offlineQueue";

type PaymentType = "cash" | "upi" | "card" | "credit";

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit: "Credit",
};

const QTY_DECIMALS = 3;

/** Dark title bar for a field grouping within a Card (Sale Type / Vehicle Details / Pump
 *  Details / Mileage Check) — deliberately not theme-reactive so the label always reads as a
 *  fixed-contrast heading regardless of light/dark mode. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white">
      {children}
    </div>
  );
}

export default function BillingPage() {
  const session = useRequireSession(["super_admin", "owner", "operator"]);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [paymentType, setPaymentType] = useState<PaymentType>("cash");
  const [upiConfirmed, setUpiConfirmed] = useState(false);
  const [customerCode, setCustomerCode] = useState("");
  const [customerInfo, setCustomerInfo] = useState<Customer | null>(null);
  const [vehicleNo, setVehicleNo] = useState("");
  const [pumpCode, setPumpCode] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [lineItemCode, setLineItemCode] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [lineAmount, setLineAmount] = useState("");
  const [lineTrackMileage, setLineTrackMileage] = useState(false);
  const [lineOdoOpening, setLineOdoOpening] = useState("");
  const [lineOdoClosing, setLineOdoClosing] = useState("");
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [selectedOrderNo, setSelectedOrderNo] = useState<number | null>(null);
  const [pendingOrderLineTag, setPendingOrderLineTag] = useState<number | null>(null);
  const [lines, setLines] = useState<BillingDraftLine[]>([]);
  const [invoice, setInvoice] = useState<SettleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [lookupBillNo, setLookupBillNo] = useState("");
  const [lookupResult, setLookupResult] = useState<SettleResponse | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [recentBills, setRecentBills] = useState<Bill[]>([]);
  const [drafts, setDrafts] = useState<BillingDraft[]>([]);

  const [businessDate, setBusinessDate] = useState<string | null>(null);
  const [closingDay, setClosingDay] = useState(false);
  const [closeDayError, setCloseDayError] = useState<string | null>(null);

  const [offlineModeAllowed, setOfflineModeAllowed] = useState(false);
  const [queuedBillCount, setQueuedBillCount] = useState(0);
  const [syncingBills, setSyncingBills] = useState(false);

  const refreshQueuedBillCount = useCallback(() => {
    getQueuedBills()
      .then((queued) => setQueuedBillCount(queued.length))
      .catch(() => undefined);
  }, []);

  const syncQueuedBills = useCallback(async () => {
    if (!session) return;
    setSyncingBills(true);
    try {
      await flushBillQueue(session.token);
    } finally {
      setSyncingBills(false);
      refreshQueuedBillCount();
      refreshRecentBills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, refreshQueuedBillCount]);

  useEffect(() => {
    if (!session) return;
    api
      .listItems(session.token)
      .then((data) => {
        setItems(data);
        if (data.length > 0) setLineItemCode(data[0].code);
      })
      .catch(() => undefined);
    api.listCustomers(session.token).then(setCustomers).catch(() => undefined);
    api.listPumps(session.token).then(setPumps).catch(() => undefined);
    api.getTenant(session.token).then(setTenant).catch(() => undefined);
    api
      .getSettings(session.token)
      .then((s) => setOfflineModeAllowed(s.OFFLINEMODE === "YES"))
      .catch(() => undefined);
    refreshBusinessDate();
    refreshRecentBills();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from localStorage, an external system
    setDrafts(listDrafts());

    refreshQueuedBillCount();
    syncQueuedBills();
    window.addEventListener("online", syncQueuedBills);
    const interval = setInterval(syncQueuedBills, 20_000);
    return () => {
      window.removeEventListener("online", syncQueuedBills);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function refreshBusinessDate() {
    if (!session) return;
    api.getBusinessDate(session.token).then((r) => setBusinessDate(r.date)).catch(() => undefined);
  }

  async function handleCloseDay() {
    if (!session || !businessDate) return;
    if (
      !window.confirm(
        `Close billing for ${businessDate}? No further bills can post to this date afterwards, and the running date will move forward.`,
      )
    )
      return;
    setClosingDay(true);
    setCloseDayError(null);
    try {
      const result = await api.closeDay(session.token);
      setBusinessDate(result.runningDate);
    } catch (err) {
      setCloseDayError(err instanceof ApiError ? err.message : "Failed to close the day");
    } finally {
      setClosingDay(false);
    }
  }

  function refreshRecentBills() {
    if (!session) return;
    api
      .getRecentBills(session.token, 10)
      .then((bills) => setRecentBills(bills.filter((b) => b.status !== "cancelled").slice(0, 5)))
      .catch(() => undefined);
  }

  // Credit bills require a known customer — look theirs up (due/credit-limit) as soon as the
  // code matches one on file, mirroring BILLEN.BAK's "Credit Limit: Rs. X" on-screen display.
  useEffect(() => {
    const known =
      session && paymentType === "credit" && customerCode
        ? customers.find((c) => c.code.toUpperCase() === customerCode.trim().toUpperCase())
        : undefined;

    if (!known || !session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived UI state (not credit / no match yet), not a subscription
      setCustomerInfo(null);
      setPendingOrders([]);
      setSelectedOrderNo(null);
      return;
    }
    api.getCustomer(session.token, known.code).then(setCustomerInfo).catch(() => setCustomerInfo(null));
    api
      .listCustomerOrders(session.token, known.code)
      .then(setPendingOrders)
      .catch(() => setPendingOrders([]));
  }, [session, paymentType, customerCode, customers]);

  function selectPaymentType(next: PaymentType) {
    setPaymentType(next);
    setUpiConfirmed(false);
    if (next !== "credit") {
      setCustomerCode("");
      setCustomerInfo(null);
      setOrderNo("");
    }
  }

  function rateFor(itemCode: string): number {
    return items.find((i) => i.code === itemCode)?.price_retail ?? 0;
  }

  // Amount and Qty are two views of the same line — editing either recalculates the other from
  // the selected item's rate, so a cashier can enter "₹500 of petrol" just as easily as a litre count.
  function handleQtyChange(value: string) {
    setLineQty(value);
    const rate = rateFor(lineItemCode);
    setLineAmount(rate > 0 && value ? (Number(value) * rate).toFixed(2) : "");
  }

  function handleAmountChange(value: string) {
    setLineAmount(value);
    const rate = rateFor(lineItemCode);
    setLineQty(rate > 0 && value ? (Number(value) / rate).toFixed(QTY_DECIMALS) : "");
  }

  function handleItemChange(code: string) {
    setLineItemCode(code);
    const rate = rateFor(code);
    if (lineQty) {
      setLineAmount(rate > 0 ? (Number(lineQty) * rate).toFixed(2) : "");
    } else if (lineAmount) {
      setLineQty(rate > 0 ? (Number(lineAmount) / rate).toFixed(QTY_DECIMALS) : "");
    }
    setLineTrackMileage(false);
    setLineOdoOpening("");
    setLineOdoClosing("");
    setPendingOrderLineTag(null);
  }

  // Pre-fills the entry row from a pending order line (capped to what's left) and tags the
  // *next* addLine() call with it — the same one-shot "tag on add" mechanic as mileage above.
  function selectPendingLine(line: OrderLine) {
    const pending = Math.max(line.qty_ordered - line.qty_served, 0);
    setLineItemCode(line.item_code);
    setLineQty(String(pending));
    const rate = rateFor(line.item_code);
    setLineAmount(rate > 0 ? (pending * rate).toFixed(2) : "");
    setPendingOrderLineTag(line.id);
  }

  function addLine() {
    if (!lineItemCode || !lineQty || Number(lineQty) <= 0) return;
    if (lineTrackMileage) {
      if (lines.some((l) => l.odometerOpening !== undefined)) return;
      if (!lineOdoOpening || !lineOdoClosing || Number(lineOdoClosing) <= Number(lineOdoOpening)) return;
    }
    setLines((prev) => [
      ...prev,
      {
        item_code: lineItemCode,
        qty: Number(lineQty),
        ...(lineTrackMileage
          ? { odometerOpening: Number(lineOdoOpening), odometerClosing: Number(lineOdoClosing) }
          : {}),
        ...(pendingOrderLineTag !== null ? { orderLineId: pendingOrderLineTag } : {}),
      },
    ]);
    resetEntryRow();
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setLines([]);
    setPaymentType("cash");
    setCustomerCode("");
    setCustomerInfo(null);
    setVehicleNo("");
    setOrderNo("");
    setUpiConfirmed(false);
    setPendingOrders([]);
    setSelectedOrderNo(null);
  }

  function resetEntryRow() {
    setLineQty("");
    setLineAmount("");
    setLineTrackMileage(false);
    setLineOdoOpening("");
    setLineOdoClosing("");
    setPendingOrderLineTag(null);
  }

  function handleCancelEntry() {
    const hasWork = lines.length > 0 || vehicleNo || customerCode || orderNo || lineQty || lineAmount;
    if (!hasWork) return;
    if (!window.confirm("Discard this bill and start over? Any added lines will be lost.")) return;
    resetForm();
    resetEntryRow();
    setError(null);
  }

  const grandTotal = lines.reduce((sum, l) => sum + rateFor(l.item_code) * l.qty, 0);
  const canSubmit =
    lines.length > 0 &&
    (paymentType !== "credit" || customerCode.trim().length > 0) &&
    (paymentType !== "upi" || upiConfirmed);
  const selectedItemName = items.find((i) => i.code === lineItemCode)?.name ?? "";
  const selectedItemTracksMileage = items.find((i) => i.code === lineItemCode)?.track_mileage === 1;
  // Legacy MAGE only ever tracked one odometer pair per bill (one tank, one fill) — so once a
  // line carries mileage, the option is withdrawn for every other line in this sale.
  const mileageLineIndex = lines.findIndex((l) => l.odometerOpening !== undefined);
  const hasMileageLine = mileageLineIndex !== -1;
  const mileageLine = hasMileageLine ? lines[mileageLineIndex] : undefined;
  const mileageLineItemName = mileageLine ? items.find((i) => i.code === mileageLine.item_code)?.name ?? mileageLine.item_code : "";
  // A lone pending order auto-selects itself; with more than one, the biller picks via the radio
  // buttons in the Pending Order section below.
  const selectedPendingOrder =
    pendingOrders.find((o) => o.order_no === selectedOrderNo) ??
    (pendingOrders.length === 1 ? pendingOrders[0] : undefined);

  async function submitBill(autoPrint: boolean) {
    if (!session || !canSubmit) return;
    setError(null);
    setQueuedNotice(null);
    setSubmitting(true);

    const billLines = lines.map((l) => ({
      item_code: l.item_code,
      qty: l.qty,
      odometer: l.odometerClosing,
      odometerOpening: l.odometerOpening,
      orderLineId: l.orderLineId,
    }));

    try {
      const result = await api.createWalkInBill(session.token, {
        paymentType,
        customerCode: paymentType === "credit" ? customerCode : undefined,
        vehicleNo: vehicleNo || undefined,
        orderNo: paymentType === "credit" && orderNo ? orderNo : undefined,
        fulfillOrderNo: paymentType === "credit" ? selectedPendingOrder?.order_no : undefined,
        pumpCode: pumpCode || undefined,
        lines: billLines,
      });
      setInvoice(result);
      resetForm();
      refreshRecentBills();
      if (autoPrint) {
        downloadAuthed(api.invoicePdfUrl(result.bill.bill_no), session.token, `invoice-${result.bill.bill_no}.pdf`, "open");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (offlineModeAllowed) {
        // Network unreachable (server rejected nothing — never got there) rather than a
        // validation failure, and the admin has allowed offline billing — queue it locally.
        await queueBill({
          clientRef: crypto.randomUUID(),
          paymentType,
          customerCode: paymentType === "credit" ? customerCode : undefined,
          vehicleNo: vehicleNo || undefined,
          orderNo: paymentType === "credit" && orderNo ? orderNo : undefined,
          pumpCode: pumpCode || undefined,
          lines: billLines,
          queuedAt: new Date().toISOString(),
        });
        setQueuedNotice("Offline — bill queued, will sync automatically once back online.");
        resetForm();
        refreshQueuedBillCount();
      } else {
        setError("Bill creation failed — check connectivity and try again");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSaveDraft() {
    if (lines.length === 0) return;
    saveDraft({ paymentType, customerCode, vehicleNo, orderNo, pumpCode, lines });
    setDrafts(listDrafts());
    resetForm();
  }

  function handleResumeDraft(draft: BillingDraft) {
    setPaymentType(draft.paymentType);
    setCustomerCode(draft.customerCode);
    setVehicleNo(draft.vehicleNo);
    setOrderNo(draft.orderNo);
    setPumpCode(draft.pumpCode);
    setLines(draft.lines);
    setUpiConfirmed(false);
    deleteDraft(draft.id);
    setDrafts(listDrafts());
  }

  function handleDeleteDraft(id: string) {
    deleteDraft(id);
    setDrafts(listDrafts());
  }

  async function handleLookup() {
    if (!session || !lookupBillNo) return;
    setLookupError(null);
    setLookupResult(null);
    try {
      const result = await api.getBill(session.token, Number(lookupBillNo));
      setLookupResult(result);
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : "Bill not found");
    }
  }

  async function handleCancel() {
    if (!session || !lookupResult) return;
    setCancelling(true);
    try {
      await api.cancelBill(session.token, lookupResult.bill.bill_no);
      await handleLookup();
      refreshRecentBills();
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  if (!session) return null;
  const canCancel = session.role === "super_admin" || session.role === "owner";

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-primary">Walk-in Billing</h1>
          <div className="flex items-center gap-3">
            {businessDate && (
              <span className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm">
                Billing date: <span className="font-medium">{businessDate}</span>
              </span>
            )}
            {queuedBillCount > 0 && (
              <button
                onClick={syncQueuedBills}
                disabled={syncingBills}
                className="rounded-full border border-warning px-3 py-1 text-xs text-warning disabled:opacity-50"
              >
                {syncingBills ? "Syncing..." : `${queuedBillCount} bill(s) queued — sync now`}
              </button>
            )}
            <button
              onClick={handleCloseDay}
              disabled={closingDay || !businessDate}
              title="Close billing for the current date and move the running date forward one day"
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {closingDay ? "Closing..." : "Close Day"}
            </button>
          </div>
        </div>
        {closeDayError && <p className="text-sm text-error">{closeDayError}</p>}

        <DraftsQueueTable drafts={drafts} items={items} onResume={handleResumeDraft} onDelete={handleDeleteDraft} />

        {/* Master: bill header — fields shown depend on the payment type chosen */}
        <Card color="orange" className="flex flex-col gap-4">
          <div>
            <SectionLabel>Sale Type</SectionLabel>
            <div className="flex gap-1 rounded-lg border border-border p-1 ">
              {(["cash", "upi", "card", "credit"] as PaymentType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => selectPaymentType(type)}
                  className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                    paymentType === type
                      ? "bg-primary text-white"
                      : "text-fg-muted hover:bg-card-hover dark:text-zinc-400 "
                  }`}
                >
                  {PAYMENT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            {paymentType === "upi" && (
              <PaymentQrPanel
                qrCode={tenant?.payment_qr_code ?? null}
                confirmed={upiConfirmed}
                onConfirmChange={setUpiConfirmed}
              />
            )}
          </div>

          <div>
            <SectionLabel>Vehicle Details</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {paymentType === "credit" && (
                <div className="flex-1">
                  <Combobox
                    options={customers.map((c) => ({ value: c.code, label: c.name }))}
                    value={customerCode}
                    onChange={setCustomerCode}
                    placeholder="Customer code (required)"
                    className="uppercase"
                  />
                </div>
              )}
              <input
                placeholder="Vehicle no. (optional)"
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm uppercase  bg-bg-elevated"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
              />
            </div>

            {paymentType === "credit" && (
              <div className="mt-2">
                <input
                  placeholder="Order number (optional)"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-bg-elevated"
                  value={orderNo}
                  onChange={(e) => setOrderNo(e.target.value)}
                />
              </div>
            )}

            {paymentType === "credit" && customerInfo && (
              <div className="mt-3 rounded-lg bg-card-hover px-3 py-2 text-sm bg-bg-elevated">
                <span className="font-medium">{customerInfo.name}</span> — due ₹
                {customerInfo.due_amount.toFixed(2)} · credit limit{" "}
                <span
                  className={
                    customerInfo.credit_limit > 0 && customerInfo.due_amount + grandTotal > customerInfo.credit_limit
                      ? "font-medium text-error"
                      : ""
                  }
                >
                  ₹{customerInfo.credit_limit.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <div>
            <SectionLabel>Pump Details</SectionLabel>
            <Combobox
              options={pumps.map((p) => ({ value: p.code, label: p.name }))}
              value={pumpCode}
              onChange={setPumpCode}
              placeholder="Pump (optional)"
            />
          </div>
        </Card>

        {/* Credit sales only — shows the customer's still-open order(s) so the biller can bill
            against one instead of re-typing what was already agreed. */}
        {paymentType === "credit" && pendingOrders.length > 0 && (
          <Card color="orange">
            <SectionLabel>Pending Order</SectionLabel>
            {pendingOrders.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {pendingOrders.map((order) => (
                  <button
                    key={order.order_no}
                    onClick={() => setSelectedOrderNo(order.order_no)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      selectedPendingOrder?.order_no === order.order_no
                        ? "border-primary bg-primary/10"
                        : "border-border"
                    }`}
                  >
                    Order #{order.order_no}
                  </button>
                ))}
              </div>
            )}
            {selectedPendingOrder && (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-fg-muted">
                    <th className="py-1 pr-3 font-normal">Item</th>
                    <th className="py-1 pr-3 font-normal">Ordered</th>
                    <th className="py-1 pr-3 font-normal">Served</th>
                    <th className="py-1 pr-3 font-normal">Pending</th>
                    <th className="py-1 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {selectedPendingOrder.lines.map((line) => {
                    const pending = line.qty_ordered - line.qty_served;
                    return (
                      <tr key={line.id} className="border-b border-border">
                        <td className="py-1 pr-3">
                          {items.find((i) => i.code === line.item_code)?.name ?? line.item_code}
                        </td>
                        <td className="py-1 pr-3">{line.qty_ordered}</td>
                        <td className="py-1 pr-3">{line.qty_served}</td>
                        <td className="py-1 pr-3">{pending.toFixed(3)}</td>
                        <td className="py-1 pr-3">
                          {pending > 0 && (
                            <button
                              onClick={() => selectPendingLine(line)}
                              className="text-primary hover:underline"
                            >
                              Bill this
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        )}

        {/* Detail: line items */}
        <Card color="orange" className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[42%]" />
              <col className="w-[15%]" />
              <col className="w-[13%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border ">
                <th className="py-2 pr-4">Item</th>
                <th className="py-2 pr-4">Qty</th>
                <th className="py-2 pr-4">Rate</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const item = items.find((it) => it.code === line.item_code);
                const rate = rateFor(line.item_code);
                return (
                  <tr key={i} className="border-b border-border ">
                    <td className="py-2 pr-4 font-medium text-fg">
                      {item?.name ?? line.item_code}
                      {line.odometerOpening !== undefined && line.odometerClosing !== undefined && (
                        <div className="text-xs font-normal text-fg-muted">
                          {line.odometerOpening} → {line.odometerClosing} km
                          {line.qty > 0 &&
                            ` · ${((line.odometerClosing - line.odometerOpening) / line.qty).toFixed(2)} km/l`}
                        </div>
                      )}
                      {line.orderLineId !== undefined && (
                        <div className="text-xs font-normal text-fg-muted">Fulfills pending order</div>
                      )}
                    </td>
                    <td className="py-2 pr-4">{line.qty}</td>
                    <td className="py-2 pr-4">₹{rate.toFixed(2)}</td>
                    <td className="py-2 pr-4">₹{(rate * line.qty).toFixed(2)}</td>
                    <td className="py-2 pr-4">
                      <button onClick={() => removeLine(i)} className="text-error hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    <Combobox
                      options={items.map((item) => ({ value: item.code, label: item.name }))}
                      value={lineItemCode}
                      onChange={handleItemChange}
                      className="w-28 shrink-0"
                      placeholder="Item..."
                    />
                    {selectedItemName && (
                      <span className="truncate text-sm font-medium text-fg">{selectedItemName}</span>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="Qty"
                    className="w-20 rounded-lg border border-border px-2 py-1.5 text-sm  bg-bg-elevated"
                    value={lineQty}
                    onChange={(e) => handleQtyChange(e.target.value)}
                  />
                </td>
                <td className="py-2 pr-4 text-fg-muted">₹{rateFor(lineItemCode).toFixed(2)}</td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount"
                    title="Enter an amount to auto-calculate quantity from the rate"
                    className="w-24 rounded-lg border border-border px-2 py-1.5 text-sm bg-bg-elevated"
                    value={lineAmount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                  />
                </td>
                <td className="py-2 pr-4">
                  <div className="flex gap-1">
                    <button onClick={addLine} className="rounded-lg border border-border px-3 py-1 text-sm ">
                      Add
                    </button>
                    <button
                      onClick={resetEntryRow}
                      title="Clear the qty/amount you've typed for this line"
                      className="rounded-lg px-2 py-1 text-sm text-fg-muted hover:bg-card-hover"
                    >
                      Reset
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold ">
                  <td className="py-2 pr-4" colSpan={3}>
                    Grand total
                  </td>
                  <td className="py-2 pr-4" colSpan={2}>
                    ₹{grandTotal.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>

          {error && <p className="mt-3 text-sm text-error">{error}</p>}
          {queuedNotice && <p className="mt-3 text-sm text-warning">{queuedNotice}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => submitBill(false)}
              disabled={submitting || !canSubmit}
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => submitBill(true)}
              disabled={submitting || !canSubmit}
              className="flex-1 rounded-lg bg-primary/90 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save and Print"}
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={lines.length === 0}
              title="Set this bill aside and start a fresh one — resume it later from the drafts queue above"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Save as draft
            </button>
            <button
              onClick={handleCancelEntry}
              title="Discard everything entered so far and start over"
              className="rounded-lg border border-error px-4 py-2 text-sm font-medium text-error"
            >
              Cancel
            </button>
          </div>
        </Card>

        {/* Below Item Add: mileage capture for a tank-fill line. Legacy MAGE only ever tracked
            one odometer pair per bill, so this is capped to a single mileage line per sale. */}
        {(selectedItemTracksMileage || hasMileageLine) && (
          <Card color="orange">
            <SectionLabel>Mileage Check</SectionLabel>
            {hasMileageLine && mileageLine ? (
              <p className="text-sm text-fg-muted">
                Mileage recorded for this sale — <span className="font-medium text-fg">{mileageLineItemName}</span>{" "}
                {mileageLine.odometerOpening} → {mileageLine.odometerClosing} km. Only one mileage entry is allowed
                per sale.
              </p>
            ) : (
              <>
                <label className="mb-2 flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={lineTrackMileage}
                    onChange={(e) => setLineTrackMileage(e.target.checked)}
                  />
                  Record mileage for this fill ({selectedItemName})
                </label>
                {lineTrackMileage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="Opening km"
                      className="w-32 rounded-lg border border-border px-2 py-1.5 text-sm bg-bg-elevated"
                      value={lineOdoOpening}
                      onChange={(e) => setLineOdoOpening(e.target.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="Closing km"
                      className="w-32 rounded-lg border border-border px-2 py-1.5 text-sm bg-bg-elevated"
                      value={lineOdoClosing}
                      onChange={(e) => setLineOdoClosing(e.target.value)}
                    />
                    {lineOdoOpening && lineOdoClosing && Number(lineOdoClosing) > Number(lineOdoOpening) && (
                      <span className="text-sm text-fg-muted">
                        Mileage:{" "}
                        {lineQty
                          ? ((Number(lineOdoClosing) - Number(lineOdoOpening)) / Number(lineQty)).toFixed(2)
                          : "—"}{" "}
                        km/l
                      </span>
                    )}
                    {lineOdoOpening && lineOdoClosing && Number(lineOdoClosing) <= Number(lineOdoOpening) && (
                      <span className="text-sm text-error">Closing km must be greater than opening km</span>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
        )}

        {invoice && (
          <div className="rounded-2xl border border-success/40 bg-success/10 p-4 text-sm  ">
            <h2 className="mb-2 font-medium text-success ">
              Invoice #{invoice.bill.bill_no}
            </h2>
            <p className="font-semibold">Grand total: ₹{invoice.bill.grand_total.toFixed(2)}</p>
            <p className="mt-1 italic">{invoice.amountInWords}</p>
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

        <Card color="orange">
          <h2 className="mb-4 text-lg font-semibold">Look up / cancel a bill</h2>
          <div className="mb-4 flex gap-2">
            <input
              type="number"
              placeholder="Bill number"
              className="flex-1 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={lookupBillNo}
              onChange={(e) => setLookupBillNo(e.target.value)}
            />
            <button onClick={handleLookup} className="rounded-lg border border-border px-4 py-2 text-sm ">
              Look up
            </button>
          </div>

          {lookupError && <p className="mb-3 text-sm text-error">{lookupError}</p>}

          {lookupResult && (
            <div className="rounded-2xl border border-border p-4 text-sm ">
              <p>
                Status: <span className="font-medium">{lookupResult.bill.status}</span>
                {lookupResult.bill.status === "cancelled" && lookupResult.bill.cancelled_by && (
                  <span className="text-fg-muted">
                    {" "}
                    (by {lookupResult.bill.cancelled_by} at {lookupResult.bill.cancelled_at})
                  </span>
                )}
              </p>
              {lookupResult.bill.order_no && <p>Order No: {lookupResult.bill.order_no}</p>}
              <p>Grand total: ₹{lookupResult.bill.grand_total.toFixed(2)}</p>
              <ul className="my-2">
                {lookupResult.lines.map((line) => (
                  <li key={line.id}>
                    {line.qty} × {line.item_code} = ₹{line.amount.toFixed(2)}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    downloadAuthed(
                      api.invoicePdfUrl(lookupResult.bill.bill_no),
                      session.token,
                      `invoice-${lookupResult.bill.bill_no}.pdf`,
                      "open",
                    )
                  }
                  className="rounded-lg border border-border px-3 py-1.5 text-sm "
                >
                  Print Bill
                </button>
                {canCancel && lookupResult.bill.status !== "cancelled" && (
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="rounded-lg border border-error px-3 py-1.5 text-sm text-error disabled:opacity-50"
                  >
                    {cancelling ? "Cancelling..." : "Cancel bill"}
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Reference tables — deliberately at the bottom, no PDF actions here (that lives in the
            lookup panel above); this is just "what's recently happened", read-only. */}
        <LastCompletedTable bills={recentBills.slice(0, 3)} />
        <RecentBillsTable bills={recentBills} />
      </div>
    </div>
  );
}

function billLabel(b: Bill): string {
  return b.customer_code ?? b.vehicle_no ?? "—";
}

/** Drafts saved via "Save as draft" — a table so the cashier can scan payment type/customer/
 *  total at a glance and pick the right one to resume. Client-side only (localStorage). */
function DraftsQueueTable({
  drafts,
  items,
  onResume,
  onDelete,
}: {
  drafts: BillingDraft[];
  items: Item[];
  onResume: (draft: BillingDraft) => void;
  onDelete: (id: string) => void;
}) {
  if (drafts.length === 0) return null;

  function totalFor(draft: BillingDraft): number {
    return draft.lines.reduce((sum, l) => sum + (items.find((i) => i.code === l.item_code)?.price_retail ?? 0) * l.qty, 0);
  }

  return (
    <Card color="amber" className="overflow-x-auto">
      <h2 className="mb-3 text-lg font-semibold">
        Draft queue <span className="text-sm font-normal text-fg-muted">({drafts.length})</span>
      </h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-4">Saved</th>
            <th className="py-2 pr-4">Payment</th>
            <th className="py-2 pr-4">Customer / Vehicle</th>
            <th className="py-2 pr-4">Items</th>
            <th className="py-2 pr-4">Total</th>
            <th className="py-2 pr-4" />
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => (
            <tr key={draft.id} className="border-b border-border">
              <td className="py-2 pr-4 text-fg-muted">{draft.savedAt.slice(0, 16).replace("T", " ")}</td>
              <td className="py-2 pr-4 capitalize">{draft.paymentType}</td>
              <td className="py-2 pr-4">{draft.customerCode || draft.vehicleNo || "—"}</td>
              <td className="py-2 pr-4">{draft.lines.length}</td>
              <td className="py-2 pr-4">₹{totalFor(draft).toFixed(2)}</td>
              <td className="py-2 pr-4">
                <div className="flex gap-3">
                  <button onClick={() => onResume(draft)} className="font-medium text-primary hover:underline">
                    Resume
                  </button>
                  <button onClick={() => onDelete(draft.id)} className="text-error hover:underline">
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Quick-glance table of the last 3 completed bills. */
function LastCompletedTable({ bills }: { bills: Bill[] }) {
  if (bills.length === 0) return null;
  return (
    <Card color="zinc" className="overflow-x-auto">
      <h2 className="mb-3 text-lg font-semibold">Last 3 bills</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-4">Bill #</th>
            <th className="py-2 pr-4">Time</th>
            <th className="py-2 pr-4">Payment</th>
            <th className="py-2 pr-4">Total</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.bill_no} className="border-b border-border">
              <td className="py-2 pr-4 font-mono">#{b.bill_no}</td>
              <td className="py-2 pr-4 text-fg-muted">{b.bill_date.slice(11, 16)}</td>
              <td className="py-2 pr-4 capitalize">{b.payment_type}</td>
              <td className="py-2 pr-4">₹{b.grand_total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Last 5 completed bills — a fuller reference table (date, counterparty, order no, status) for
 *  a cashier scanning back through what just happened. Read-only, no PDF action (see the lookup
 *  panel above for that). */
function RecentBillsTable({ bills }: { bills: Bill[] }) {
  if (bills.length === 0) return null;
  return (
    <Card color="zinc" className="overflow-x-auto">
      <h2 className="mb-3 text-lg font-semibold">Recent bills</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-4">Bill #</th>
            <th className="py-2 pr-4">Date</th>
            <th className="py-2 pr-4">Payment</th>
            <th className="py-2 pr-4">Customer / Vehicle</th>
            <th className="py-2 pr-4">Order No</th>
            <th className="py-2 pr-4">Total</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.bill_no} className="border-b border-border">
              <td className="py-2 pr-4 font-mono">#{b.bill_no}</td>
              <td className="py-2 pr-4 text-fg-muted">{b.bill_date}</td>
              <td className="py-2 pr-4 capitalize">{b.payment_type}</td>
              <td className="py-2 pr-4">{billLabel(b)}</td>
              <td className="py-2 pr-4 text-fg-muted">{b.order_no ?? "—"}</td>
              <td className="py-2 pr-4">₹{b.grand_total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
