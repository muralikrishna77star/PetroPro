"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  api,
  ApiError,
  type Bill,
  type Customer,
  type Item,
  type Order,
  type OrderLine,
  type Pump,
  type SettleResponse,
  type Tenant,
  type Vehicle,
} from "@/lib/api";
import { findVehicle, similarVehicles, vehicleKey } from "@/lib/vehicles";
import { useRequireSession } from "@/lib/useSession";
import { BillPrintActions } from "@/components/BillPrintActions";
import { Card } from "@/components/Card";
import { SectionLabel } from "@/components/SectionLabel";
import { Combobox } from "@/components/ui/Combobox";
import { PaymentQrPanel } from "@/components/PaymentQrPanel";
import { SendInvoiceButton } from "@/components/SendInvoiceButton";
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

/** What's still to be served on a purchase-order line (0 for an unknown line). */
function pendingQty(line: OrderLine | undefined): number {
  if (!line) return 0;
  return Math.max(Number((line.qty_ordered - line.qty_served).toFixed(QTY_DECIMALS)), 0);
}

export default function BillingPage() {
  const session = useRequireSession(["super_admin", "owner", "operator"]);
  const [printOnSave, setPrintOnSave] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  // The vehicle master, for the vehicle box: picking a customer's vehicle fills in the customer.
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
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
  const lineItemCodeRef = useRef<HTMLInputElement>(null);
  const [lineQty, setLineQty] = useState("");
  const [lineAmount, setLineAmount] = useState("");
  const [lineTrackMileage, setLineTrackMileage] = useState(false);
  const [lineOdoOpening, setLineOdoOpening] = useState("");
  const [lineOdoClosing, setLineOdoClosing] = useState("");
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  // The customer purchase order this bill is drawing on (picked from pendingOrders), if any.
  const [selectedOrderNo, setSelectedOrderNo] = useState<number | null>(null);
  const [lines, setLines] = useState<BillingDraftLine[]>([]);
  const [invoice, setInvoice] = useState<SettleResponse | null>(null);
  // Snapshot of who the bill was for, captured before resetForm() clears customerCode/
  // customerInfo — SendInvoiceButton (WhatsApp Invoice Module) needs it after the form resets.
  const [invoiceCustomer, setInvoiceCustomer] = useState<Customer | null>(null);
  // undefined = still resolving (or nothing looked up yet), null = resolved: no customer on this
  // bill. Distinguishing the two matters for SendInvoiceButton below — it shouldn't mount with a
  // stale/empty customerPhone while the async lookup for a *known* customer_code is in flight.
  const [lookupCustomer, setLookupCustomer] = useState<Customer | null | undefined>(undefined);
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

  const [offlineModeAllowed, setOfflineModeAllowed] = useState(false);
  const [queuedBillCount, setQueuedBillCount] = useState(0);
  const [syncingBills, setSyncingBills] = useState(false);

  // Full-screen mode for tablets: hides the app menu and top bar (CSS keyed off
  // html[data-full-screen], see globals.css) and, where the browser allows it, also asks for real
  // browser full screen so the address bar goes too. Browsers without element full screen (iPhone
  // Safari) still get the menu-less layout.
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (fullScreen) root.dataset.fullScreen = "";
    else delete root.dataset.fullScreen;
    return () => {
      delete root.dataset.fullScreen;
    };
  }, [fullScreen]);

  useEffect(() => {
    // Leaving browser full screen another way (Esc, Android back) also brings the menu back.
    function onFullscreenChange() {
      if (!document.fullscreenElement) setFullScreen(false);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      // Navigating away from Billing shouldn't leave the browser stuck in full screen.
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  function toggleFullScreen() {
    if (!fullScreen) {
      setFullScreen(true);
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else {
      setFullScreen(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    }
  }

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
    refreshVehicles();
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

  function refreshVehicles() {
    if (!session) return;
    api.listVehicles(session.token).then(setVehicles).catch(() => undefined);
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
      // Purchase orders are credit-only, so their lines go with the credit sale type.
      dropOrderLines();
    } else if (!customerCode.trim()) {
      // Vehicle entered before switching to Credit: its owner becomes the customer.
      const owner = findVehicle(vehicles, vehicleNo)?.customer_code;
      if (owner) setCustomerCode(owner);
    }
  }

  // A purchase order belongs to one customer — changing the customer code takes its lines off the bill.
  function handleCustomerChange(code: string) {
    setCustomerCode(code);
    if (selectedOrderNo !== null) dropOrderLines();
    // A customer with just one vehicle on file gets it filled in.
    const own = vehicles.filter((v) => v.customer_code === code.trim().toUpperCase());
    if (own.length === 1 && !vehicleNo.trim()) setVehicleNo(own[0].vehicle_no);
  }

  // Vehicle entered first: a vehicle on file under a customer fills in that customer for a Credit
  // sale (and is shown for the others, whose bill picks the owner up on the server anyway).
  function handleVehicleChange(value: string) {
    setVehicleNo(value);
    const onFile = findVehicle(vehicles, value);
    if (onFile?.customer_code && paymentType === "credit" && !customerCode.trim()) {
      setCustomerCode(onFile.customer_code);
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
  }

  function orderLineFor(line: OrderLine): BillingDraftLine {
    return { item_code: line.item_code, qty: pendingQty(line), orderLineId: line.id };
  }

  // Picking a purchase order brings its still-pending items onto the bill, each tagged with its
  // order line so the server draws the quantity off the order. Lines already on the bill that
  // aren't from an order stay only if this order allows extra items.
  function applyOrder(order: Order) {
    const otherLines = lines.filter((l) => l.orderLineId === undefined);
    if (otherLines.length > 0 && !order.allow_extra_items) {
      if (
        !window.confirm(
          `PO #${order.order_no} allows only its own items. Remove the ${otherLines.length} other line(s) already on this bill?`,
        )
      )
        return;
    }
    const orderLines = order.lines.filter((l) => pendingQty(l) > 0).map(orderLineFor);
    setLines([...orderLines, ...(order.allow_extra_items ? otherLines : [])]);
    setSelectedOrderNo(order.order_no);
    if (!vehicleNo && order.vehicle_no) setVehicleNo(order.vehicle_no);
    // The free-text order number is what prints on the invoice, so it carries the PO number.
    if (!orderNo || orderNo === String(selectedOrderNo)) setOrderNo(String(order.order_no));
  }

  function dropOrderLines() {
    setLines((prev) => prev.filter((l) => l.orderLineId === undefined));
    if (selectedOrderNo !== null && orderNo === String(selectedOrderNo)) setOrderNo("");
    setSelectedOrderNo(null);
  }

  // Brings back an order line the biller removed from this bill.
  function addBackOrderLine(line: OrderLine) {
    setLines((prev) => [...prev, orderLineFor(line)]);
  }

  // Serving part of an order line today (e.g. 60 of 100 L): the biller edits the line's qty.
  function setLineQtyAt(index: number, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, qty: Number(value) || 0 } : l)));
  }

  function addLine() {
    if (strictOrder) return;
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
      },
    ]);
    resetEntryRow();
    // Ready for the next line: cursor back on Item Code with the last code selected, so typing
    // the next code replaces it.
    lineItemCodeRef.current?.focus();
    lineItemCodeRef.current?.select();
  }

  // Enter in Qty or Amount adds the line, so a bill can be keyed in without the mouse.
  function addLineOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addLine();
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
  const selectedOrder =
    paymentType === "credit" ? pendingOrders.find((o) => o.order_no === selectedOrderNo) : undefined;
  // A purchase order the customer placed without "allow other items": only its own lines can be billed.
  const strictOrder = selectedOrder !== undefined && !selectedOrder.allow_extra_items;
  const orderLineById = new Map((selectedOrder?.lines ?? []).map((l) => [l.id, l]));
  // Total of each order line already on this bill, to catch serving more than is pending.
  const billedPerOrderLine = new Map<number, number>();
  for (const l of lines) {
    if (l.orderLineId !== undefined) billedPerOrderLine.set(l.orderLineId, (billedPerOrderLine.get(l.orderLineId) ?? 0) + l.qty);
  }
  const overServedLineIds = new Set(
    [...billedPerOrderLine].filter(([id, qty]) => qty > pendingQty(orderLineById.get(id)) + 1e-9).map(([id]) => id),
  );
  // Order lines the biller took off this bill, offered back in the Purchase Orders card.
  const removedOrderLines = (selectedOrder?.lines ?? []).filter(
    (l) => pendingQty(l) > 0 && !lines.some((bl) => bl.orderLineId === l.id),
  );
  const canSubmit =
    lines.length > 0 &&
    lines.every((l) => l.qty > 0) &&
    overServedLineIds.size === 0 &&
    (!strictOrder || lines.every((l) => l.orderLineId !== undefined)) &&
    (paymentType !== "credit" || (customerCode.trim().length > 0 && vehicleNo.trim().length > 0)) &&
    (paymentType !== "upi" || upiConfirmed);
  const selectedItemName = items.find((i) => i.code === lineItemCode)?.name ?? "";
  const customerNameFor = (code: string) => customers.find((c) => c.code === code)?.name ?? "";
  const creditCustomer = paymentType === "credit" ? customerCode.trim().toUpperCase() : "";
  const creditCustomerVehicles = creditCustomer ? vehicles.filter((v) => v.customer_code === creditCustomer) : [];
  // With a Credit customer chosen, the box offers that customer's vehicles; otherwise every vehicle.
  const vehicleOptions = (creditCustomerVehicles.length > 0 ? creditCustomerVehicles : vehicles).map((v) => ({
    value: v.vehicle_no,
    label: v.customer_code ? `${v.vehicle_no} — ${v.customer_code} ${customerNameFor(v.customer_code)}` : v.vehicle_no,
  }));
  const vehicleOnFile = findVehicle(vehicles, vehicleNo);
  const vehicleSuggestions = vehicleOnFile ? [] : similarVehicles(vehicles, vehicleNo);
  const selectedItemTracksMileage = items.find((i) => i.code === lineItemCode)?.track_mileage === 1;
  // Legacy MAGE only ever tracked one odometer pair per bill (one tank, one fill) — so once a
  // line carries mileage, the option is withdrawn for every other line in this sale.
  const mileageLineIndex = lines.findIndex((l) => l.odometerOpening !== undefined);
  const hasMileageLine = mileageLineIndex !== -1;
  const mileageLine = hasMileageLine ? lines[mileageLineIndex] : undefined;
  const mileageLineItemName = mileageLine ? items.find((i) => i.code === mileageLine.item_code)?.name ?? mileageLine.item_code : "";
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
        fulfillOrderNo: selectedOrder?.order_no,
        pumpCode: pumpCode || undefined,
        lines: billLines,
      });
      setInvoice(result);
      setPrintOnSave(autoPrint);
      setInvoiceCustomer(paymentType === "credit" ? customerInfo : null);
      resetForm();
      refreshRecentBills();
      refreshVehicles();
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
          fulfillOrderNo: selectedOrder?.order_no,
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
    saveDraft({ paymentType, customerCode, vehicleNo, orderNo, fulfillOrderNo: selectedOrder?.order_no, pumpCode, lines });
    setDrafts(listDrafts());
    resetForm();
  }

  function handleResumeDraft(draft: BillingDraft) {
    setPaymentType(draft.paymentType);
    setCustomerCode(draft.customerCode);
    setVehicleNo(draft.vehicleNo);
    setOrderNo(draft.orderNo);
    setSelectedOrderNo(draft.fulfillOrderNo ?? null);
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
    setLookupCustomer(undefined);
    try {
      const result = await api.getBill(session.token, Number(lookupBillNo));
      setLookupResult(result);
      // For SendInvoiceButton (WhatsApp Invoice Module) to auto-fill the customer's number —
      // the bill only carries customer_code, not phone/name. No customer on the bill resolves
      // immediately (null); a real customer_code resolves once the fetch below completes.
      if (result.bill.customer_code) {
        api
          .getCustomer(session.token, result.bill.customer_code)
          .then(setLookupCustomer)
          .catch(() => setLookupCustomer(null));
      } else {
        setLookupCustomer(null);
      }
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
      <div className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 ${fullScreen ? "py-2" : "max-w-6xl py-8"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-primary">Just Billing</h1>
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
              onClick={toggleFullScreen}
              aria-label={fullScreen ? "Exit full screen" : "Full screen"}
              title={fullScreen ? "Exit full screen and show the menu again" : "Full screen — hide the menu so Billing fills the screen"}
              className="rounded-lg border border-border p-2 text-fg-muted hover:bg-card-hover hover:text-fg"
            >
              {fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
        </div>

        <DraftsQueueTable drafts={drafts} items={items} onResume={handleResumeDraft} onDelete={handleDeleteDraft} />

        {/* Master: bill header — fields shown depend on the payment type chosen */}
        <Card color="orange" className="flex flex-col gap-4">
          <div>
            <SectionLabel>Sale Type</SectionLabel>
            <div className="flex gap-1 rounded-lg border border-border p-1 ">
              {(["cash", "credit", "card", "upi"] as PaymentType[]).map((type) => (
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
              <div className="flex-1">
                <Combobox
                  options={vehicleOptions}
                  value={vehicleNo}
                  onChange={handleVehicleChange}
                  normalize={vehicleKey}
                  placeholder="Vehicle no."
                  aria-label="Vehicle no."
                  className="uppercase"
                />
              </div>
              {paymentType === "credit" && (
                <div className="flex-1">
                  <Combobox
                    options={customers.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
                    value={customerCode}
                    onChange={handleCustomerChange}
                    placeholder="Customer code"
                    aria-label="Customer code"
                    className="uppercase"
                  />
                </div>
              )}
            </div>

            {vehicleNo.trim() && vehicleOnFile?.customer_code && (
              <p className="mt-2 text-sm text-fg-muted">
                {vehicleOnFile.vehicle_no} belongs to{" "}
                <span className="font-medium text-fg">
                  {vehicleOnFile.customer_code} {customerNameFor(vehicleOnFile.customer_code)}
                </span>
                {paymentType === "credit" &&
                  customerCode.trim() &&
                  customerCode.trim().toUpperCase() !== vehicleOnFile.customer_code && (
                    <span className="text-warning"> — not the customer on this bill</span>
                  )}
              </p>
            )}
            {vehicleKey(vehicleNo).length >= 2 && !vehicleOnFile && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {vehicleSuggestions.length > 0 ? (
                  <>
                    <span className="text-warning">Not on file. Did you mean</span>
                    {vehicleSuggestions.map((v) => (
                      <button
                        key={v.vehicle_no}
                        onClick={() => handleVehicleChange(v.vehicle_no)}
                        className="rounded-lg border border-border px-2 py-0.5 font-mono hover:bg-card-hover"
                      >
                        {v.vehicle_no}
                        {v.customer_code ? ` (${v.customer_code})` : ""}
                      </button>
                    ))}
                  </>
                ) : (
                  <span className="text-fg-muted">
                    New vehicle {vehicleKey(vehicleNo)} — it will be added to the vehicle master
                    {paymentType === "credit" && customerCode.trim() ? ` under ${customerCode.trim().toUpperCase()}` : ""}.
                  </span>
                )}
              </div>
            )}

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

        {/* Credit sales only — the customer's open purchase orders (placed from the customer
            portal). Picking one loads its pending items onto the bill below. */}
        {paymentType === "credit" && pendingOrders.length > 0 && (
          <Card color="orange" className="overflow-x-auto">
            <SectionLabel>Purchase Orders</SectionLabel>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-fg-muted">
                  <th className="py-1 pr-3 font-normal">PO #</th>
                  <th className="py-1 pr-3 font-normal">Placed</th>
                  <th className="py-1 pr-3 font-normal">Vehicle</th>
                  <th className="py-1 pr-3 font-normal">Pending items</th>
                  <th className="py-1 pr-3 font-normal">Other items</th>
                  <th className="py-1 pr-3" />
                </tr>
              </thead>
              <tbody>
                {pendingOrders.map((order) => {
                  const selected = selectedOrder?.order_no === order.order_no;
                  const pendingLines = order.lines.filter((l) => pendingQty(l) > 0);
                  return (
                    <tr key={order.order_no} className={`border-b border-border ${selected ? "bg-primary/10" : ""}`}>
                      <td className="py-1.5 pr-3 font-mono">#{order.order_no}</td>
                      <td className="py-1.5 pr-3 text-fg-muted">{order.created_at.slice(0, 10)}</td>
                      <td className="py-1.5 pr-3">{order.vehicle_no ?? "—"}</td>
                      <td className="py-1.5 pr-3">
                        {pendingLines
                          .map((l) => `${items.find((i) => i.code === l.item_code)?.name ?? l.item_code} × ${pendingQty(l)}`)
                          .join(", ")}
                      </td>
                      <td className="py-1.5 pr-3">{order.allow_extra_items ? "Allowed" : "Not allowed"}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {selected ? (
                          <button onClick={dropOrderLines} className="whitespace-nowrap text-error hover:underline">
                            Stop using
                          </button>
                        ) : (
                          <button
                            onClick={() => applyOrder(order)}
                            className="whitespace-nowrap font-medium text-primary hover:underline"
                          >
                            Bill this order
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {removedOrderLines.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-fg-muted">Not on this bill:</span>
                {removedOrderLines.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => addBackOrderLine(l)}
                    className="rounded-lg border border-border px-2 py-1 hover:bg-card-hover"
                  >
                    + {items.find((i) => i.code === l.item_code)?.name ?? l.item_code} × {pendingQty(l)}
                  </button>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Detail: line items */}
        <Card color="orange" className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[29%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-[15%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border ">
                <th className="py-2 pr-4">Item Code</th>
                <th className="py-2 pr-4">Item Name</th>
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
                    <td className="truncate py-2 pr-4 font-mono text-fg">{line.item_code}</td>
                    <td className="py-2 pr-4 font-medium text-fg">
                      {item?.name ?? "—"}
                      {line.odometerOpening !== undefined && line.odometerClosing !== undefined && (
                        <div className="text-xs font-normal text-fg-muted">
                          {line.odometerOpening} → {line.odometerClosing} km
                          {line.qty > 0 &&
                            ` · ${((line.odometerClosing - line.odometerOpening) / line.qty).toFixed(2)} km/l`}
                        </div>
                      )}
                      {line.orderLineId !== undefined && (
                        <div className="text-xs font-normal text-fg-muted">
                          From PO #{selectedOrder?.order_no ?? "?"} · {pendingQty(orderLineById.get(line.orderLineId))} pending
                        </div>
                      )}
                      {line.orderLineId !== undefined && overServedLineIds.has(line.orderLineId) && (
                        <div className="text-xs font-normal text-error">More than is pending on the order</div>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {line.orderLineId !== undefined ? (
                        <input
                          // Uncontrolled so typing "12." isn't reformatted mid-entry.
                          key={`${line.orderLineId}-${i}`}
                          type="number"
                          min="0"
                          max={pendingQty(orderLineById.get(line.orderLineId))}
                          step="0.001"
                          aria-label={`Qty of ${item?.name ?? line.item_code}`}
                          title="Serving less than the order today? Change the quantity."
                          className="w-20 rounded-lg border border-border bg-bg-elevated px-2 py-1 text-sm"
                          defaultValue={line.qty}
                          onChange={(e) => setLineQtyAt(i, e.target.value)}
                        />
                      ) : (
                        line.qty
                      )}
                    </td>
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
                  <Combobox
                    ref={lineItemCodeRef}
                    options={items.map((item) => ({ value: item.code, label: item.name }))}
                    value={lineItemCode}
                    onChange={handleItemChange}
                    className="w-full"
                    placeholder="Code..."
                    disabled={strictOrder}
                  />
                </td>
                <td className="truncate py-2 pr-4 font-medium text-fg">
                  {selectedItemName || <span className="font-normal text-fg-muted">—</span>}
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
                    onKeyDown={addLineOnEnter}
                    disabled={strictOrder}
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
                    onKeyDown={addLineOnEnter}
                    disabled={strictOrder}
                  />
                </td>
                <td className="py-2 pr-4">
                  <div className="flex gap-1">
                    <button
                      onClick={addLine}
                      disabled={strictOrder}
                      className="rounded-lg border border-border px-3 py-1 text-sm disabled:opacity-50"
                    >
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
              {strictOrder && (
                <tr>
                  <td colSpan={6} className="pb-2 pr-4 text-xs text-fg-muted">
                    PO #{selectedOrder.order_no} allows only its own items — the customer didn&apos;t allow other items
                    on this order.
                  </td>
                </tr>
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold ">
                  <td className="py-2 pr-4" colSpan={4}>
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
            <BillPrintActions key={invoice.bill.bill_no} billNo={invoice.bill.bill_no} token={session.token} justFinalized autoPrint={printOnSave} />
            <SendInvoiceButton
              key={invoice.bill.bill_no}
              token={session.token}
              billNo={invoice.bill.bill_no}
              amount={invoice.bill.grand_total}
              tenantName={tenant?.name ?? "PetroPro"}
              customerCode={invoiceCustomer?.code}
              customerName={invoiceCustomer?.name}
              customerPhone={invoiceCustomer?.phone}
              className="mt-3 ml-2"
            />
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
              <BillPrintActions key={lookupResult.bill.bill_no} billNo={lookupResult.bill.bill_no} token={session.token} />
              <div className="mt-2 flex gap-2">
                {lookupResult.bill.status !== "cancelled" && lookupCustomer !== undefined && (
                  <SendInvoiceButton
                    key={lookupResult.bill.bill_no}
                    token={session.token}
                    billNo={lookupResult.bill.bill_no}
                    amount={lookupResult.bill.grand_total}
                    tenantName={tenant?.name ?? "PetroPro"}
                    customerCode={lookupCustomer?.code}
                    customerName={lookupCustomer?.name}
                    customerPhone={lookupCustomer?.phone}
                  />
                )}
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
