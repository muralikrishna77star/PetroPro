"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { customerApi, ApiError, type CustomerItem, type Order } from "@/lib/api";
import { useRequireCustomerSession } from "@/lib/useCustomerSession";
import { clearCustomerSession } from "@/lib/customerAuth";
import { Card } from "@/components/Card";
import { DesignSwitcher } from "@/components/DesignSwitcher";
import { SectionLabel } from "@/components/SectionLabel";
import { Combobox } from "@/components/ui/Combobox";
import { findVehicle, similarVehicles, vehicleKey } from "@/lib/vehicles";

interface DraftLine {
  item_code: string;
  qty: number;
}

const STATUS_LABELS: Record<Order["status"], string> = {
  open: "Open",
  partially_served: "Partially served",
  completed: "Completed",
  cancelled: "Cancelled",
};

const QTY_DECIMALS = 3;

/** The customer's Purchase Order screen. Laid out like staff Billing (customer/vehicle header,
 *  then an Item Code / Name / Qty / Rate / Amount entry table), but the Customer Code is the
 *  signed-in customer's own and can't be changed. The station bills against the order from
 *  Billing, picking it from this customer's open orders. */
export default function CustomerOrdersPage() {
  const session = useRequireCustomerSession();
  const router = useRouter();
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const [vehicleNo, setVehicleNo] = useState("");
  // The customer's own vehicles, from the station's vehicle master.
  const [vehicles, setVehicles] = useState<{ vehicle_no: string }[]>([]);
  const [allowExtraItems, setAllowExtraItems] = useState(false);
  const [lineItemCode, setLineItemCode] = useState("");
  const lineItemCodeRef = useRef<HTMLInputElement>(null);
  const [lineQty, setLineQty] = useState("");
  const [lineAmount, setLineAmount] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    customerApi
      .listItems(session.token)
      .then((data) => {
        setItems(data);
        if (data.length > 0) setLineItemCode(data[0].code);
      })
      .catch(() => undefined);
    refreshOrders();
    refreshVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function refreshVehicles() {
    if (!session) return;
    customerApi
      .listVehicles(session.token)
      .then((own) => {
        setVehicles(own);
        // Only one vehicle on file: it's the one being ordered for.
        if (own.length === 1) setVehicleNo((current) => current || own[0].vehicle_no);
      })
      .catch(() => undefined);
  }

  function refreshOrders() {
    if (!session) return;
    customerApi.listOrders(session.token).then(setOrders).catch(() => undefined);
  }

  function handleLogout() {
    clearCustomerSession();
    router.push("/customer/login");
  }

  function itemName(code: string): string {
    return items.find((i) => i.code === code)?.name ?? code;
  }

  function rateFor(itemCode: string): number {
    return items.find((i) => i.code === itemCode)?.price_retail ?? 0;
  }

  // Qty and Amount are two views of the same line, as on Billing — "₹5,000 of diesel" works as
  // well as a litre count.
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
    if (lineQty) setLineAmount(rate > 0 ? (Number(lineQty) * rate).toFixed(2) : "");
    else if (lineAmount) setLineQty(rate > 0 ? (Number(lineAmount) / rate).toFixed(QTY_DECIMALS) : "");
  }

  function addLine() {
    if (!items.some((i) => i.code === lineItemCode) || !lineQty || Number(lineQty) <= 0) return;
    setLines((prev) => [...prev, { item_code: lineItemCode, qty: Number(lineQty) }]);
    setLineQty("");
    setLineAmount("");
    lineItemCodeRef.current?.focus();
    lineItemCodeRef.current?.select();
  }

  function addLineOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addLine();
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function clearForm() {
    setLines([]);
    setVehicleNo("");
    setAllowExtraItems(false);
    setLineQty("");
    setLineAmount("");
  }

  async function handleSubmit() {
    if (!session || lines.length === 0) return;
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const order = await customerApi.createOrder(session.token, {
        lines,
        allow_extra_items: allowExtraItems,
        vehicle_no: vehicleNo.trim(),
      });
      setMessage(`Purchase order #${order.order_no} placed.`);
      clearForm();
      refreshOrders();
      refreshVehicles();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the order");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(orderNo: number) {
    if (!session) return;
    if (!window.confirm("Cancel this purchase order?")) return;
    try {
      await customerApi.cancelOrder(session.token, orderNo);
      refreshOrders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel the order");
    }
  }

  if (!session) return null;

  const grandTotal = lines.reduce((sum, l) => sum + rateFor(l.item_code) * l.qty, 0);
  const selectedItemName = items.find((i) => i.code === lineItemCode)?.name ?? "";

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-primary">
            Purchase Order <span className="text-sm font-normal text-fg-muted">— {session.name}</span>
          </h1>
          <nav aria-label="Customer navigation" className="flex items-center gap-4">
            <Link href="/customer/reports" className="text-sm font-medium text-primary hover:underline">
              My reports
            </Link>
            <DesignSwitcher />
            <button onClick={handleLogout} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium">
              Sign out
            </button>
          </nav>
        </div>

        {/* Master: order header — same layout as Billing's, with the customer fixed */}
        <Card color="orange" className="flex flex-col gap-4">
          <div>
            <SectionLabel>Customer Details</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <label className="relative flex-1">
                <span className="sr-only">Customer code</span>
                <input
                  readOnly
                  aria-readonly="true"
                  tabIndex={-1}
                  value={session.customerCode}
                  title="Orders are always placed under your own customer code"
                  className="w-full cursor-not-allowed rounded-lg border border-border bg-card-hover px-3 py-2 pr-9 font-mono text-sm uppercase text-fg"
                />
                <Lock size={14} aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" />
              </label>
              <div className="flex-1">
                <Combobox
                  options={vehicles.map((v) => ({ value: v.vehicle_no, label: v.vehicle_no }))}
                  value={vehicleNo}
                  onChange={setVehicleNo}
                  normalize={vehicleKey}
                  placeholder="Vehicle no."
                  aria-label="Vehicle no."
                  required
                  className="uppercase"
                />
              </div>
            </div>
            {vehicleKey(vehicleNo).length >= 2 && !findVehicle(vehicles, vehicleNo) && (
              <p className="mt-2 text-sm">
                {similarVehicles(vehicles, vehicleNo).length > 0 ? (
                  <>
                    <span className="text-warning">Not one of your vehicles. Did you mean </span>
                    {similarVehicles(vehicles, vehicleNo).map((v) => (
                      <button
                        key={v.vehicle_no}
                        onClick={() => setVehicleNo(v.vehicle_no)}
                        className="mr-2 rounded-lg border border-border px-2 py-0.5 font-mono hover:bg-card-hover"
                      >
                        {v.vehicle_no}
                      </button>
                    ))}
                  </>
                ) : (
                  <span className="text-fg-muted">
                    New vehicle {vehicleKey(vehicleNo)} — it will be added to your account with this order.
                  </span>
                )}
              </p>
            )}
            <p className="mt-2 text-sm text-fg-muted">
              <span className="font-medium text-fg">{session.name}</span> — the order is billed to this account on credit.
            </p>
          </div>
        </Card>

        {/* Detail: order lines */}
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
              <tr className="border-b border-border">
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
                const rate = rateFor(line.item_code);
                return (
                  <tr key={i} className="border-b border-border">
                    <td className="truncate py-2 pr-4 font-mono text-fg">{line.item_code}</td>
                    <td className="py-2 pr-4 font-medium text-fg">{itemName(line.item_code)}</td>
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
                  <Combobox
                    ref={lineItemCodeRef}
                    options={items.map((item) => ({ value: item.code, label: item.name }))}
                    value={lineItemCode}
                    onChange={handleItemChange}
                    className="w-full"
                    placeholder="Code..."
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
                    className="w-20 rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-sm"
                    value={lineQty}
                    onChange={(e) => handleQtyChange(e.target.value)}
                    onKeyDown={addLineOnEnter}
                  />
                </td>
                <td className="py-2 pr-4 text-fg-muted">₹{rateFor(lineItemCode).toFixed(2)}</td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount"
                    title="Enter an amount to work out the quantity from the rate"
                    className="w-24 rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-sm"
                    value={lineAmount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    onKeyDown={addLineOnEnter}
                  />
                </td>
                <td className="py-2 pr-4">
                  <button onClick={addLine} className="rounded-lg border border-border px-3 py-1 text-sm">
                    Add
                  </button>
                </td>
              </tr>
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-2 pr-4" colSpan={4}>
                    Estimated total
                  </td>
                  <td className="py-2 pr-4" colSpan={2}>
                    ₹{grandTotal.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          <p className="mt-2 text-xs text-fg-muted">
            Rates shown are today&apos;s. Each delivery is billed at the rate on the day it&apos;s supplied.
          </p>

          <div className="mt-4">
            <SectionLabel>Billing Options</SectionLabel>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={allowExtraItems}
                onChange={(e) => setAllowExtraItems(e.target.checked)}
              />
              <span>
                Allow the station to add other essential items when billing this order
                <span className="block text-xs text-fg-muted">
                  For example engine oil or coolant the vehicle needs on the day. Leave unticked and the station can bill
                  only the items listed above.
                </span>
              </span>
            </label>
          </div>

          {error && <p className="mt-3 text-sm text-error">{error}</p>}
          {message && <p className="mt-3 text-sm text-success">{message}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting || lines.length === 0 || vehicleKey(vehicleNo).length < 2}
              title={vehicleKey(vehicleNo).length < 2 ? "Enter the vehicle number first" : undefined}
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Placing order..." : "Place purchase order"}
            </button>
            <button
              onClick={clearForm}
              disabled={submitting}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </Card>

        <Card color="zinc" className="overflow-x-auto">
          <h2 className="mb-3 text-lg font-semibold">My purchase orders</h2>
          {orders.length === 0 && <p className="text-sm text-fg-muted">No orders yet.</p>}
          <div className="flex flex-col gap-4">
            {orders.map((order) => {
              const canCancel =
                (order.status === "open" || order.status === "partially_served") &&
                order.lines.every((l) => l.qty_served === 0);
              return (
                <div key={order.order_no} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">PO #{order.order_no}</span>
                      <span className="ml-2 text-xs text-fg-muted">
                        {order.created_at.slice(0, 16)}
                        {order.vehicle_no && ` · ${order.vehicle_no}`}
                        {order.allow_extra_items ? " · extra items allowed" : " · listed items only"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                        {STATUS_LABELS[order.status]}
                      </span>
                      {canCancel && (
                        <button onClick={() => handleCancel(order.order_no)} className="text-xs text-error hover:underline">
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-fg-muted">
                        <th className="py-1 pr-3 font-normal">Item</th>
                        <th className="py-1 pr-3 font-normal">Ordered</th>
                        <th className="py-1 pr-3 font-normal">Served</th>
                        <th className="py-1 pr-3 font-normal">Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="py-1 pr-3">{itemName(line.item_code)}</td>
                          <td className="py-1 pr-3">{line.qty_ordered}</td>
                          <td className="py-1 pr-3">{line.qty_served}</td>
                          <td className="py-1 pr-3">{(line.qty_ordered - line.qty_served).toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
