"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, customerApi, ApiError, type Item, type Order } from "@/lib/api";
import { useRequireCustomerSession } from "@/lib/useCustomerSession";
import { clearCustomerSession } from "@/lib/customerAuth";
import { Card } from "@/components/Card";
import { Combobox } from "@/components/ui/Combobox";

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

export default function CustomerOrdersPage() {
  const session = useRequireCustomerSession();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const [lineItemCode, setLineItemCode] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    api
      .listItems(session.token)
      .then((data) => {
        setItems(data);
        if (data.length > 0) setLineItemCode(data[0].code);
      })
      .catch(() => undefined);
    refreshOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

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

  function addLine() {
    if (!lineItemCode || !lineQty || Number(lineQty) <= 0) return;
    setLines((prev) => [...prev, { item_code: lineItemCode, qty: Number(lineQty) }]);
    setLineQty("");
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!session || lines.length === 0) return;
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const order = await customerApi.createOrder(session.token, { lines });
      setMessage(`Order #${order.order_no} placed.`);
      setLines([]);
      refreshOrders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place order");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(orderNo: number) {
    if (!session) return;
    if (!window.confirm("Cancel this order?")) return;
    try {
      await customerApi.cancelOrder(session.token, orderNo);
      refreshOrders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel order");
    }
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-primary">
            Order Entry <span className="text-sm font-normal text-fg-muted">— {session.name}</span>
          </h1>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium"
          >
            Sign out
          </button>
        </div>

        <Card color="orange" className="overflow-x-auto">
          <h2 className="mb-3 text-lg font-semibold">Place a new order</h2>
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[55%]" />
              <col className="w-[20%]" />
              <col className="w-[25%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Item</th>
                <th className="py-2 pr-4">Qty</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="py-2 pr-4 font-medium text-fg">{itemName(line.item_code)}</td>
                  <td className="py-2 pr-4">{line.qty}</td>
                  <td className="py-2 pr-4">
                    <button onClick={() => removeLine(i)} className="text-error hover:underline">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-4">
                  <Combobox
                    options={items.map((item) => ({ value: item.code, label: item.name }))}
                    value={lineItemCode}
                    onChange={setLineItemCode}
                    placeholder="Item..."
                  />
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="Qty"
                    className="w-20 rounded-lg border border-border px-2 py-1.5 text-sm bg-bg-elevated"
                    value={lineQty}
                    onChange={(e) => setLineQty(e.target.value)}
                  />
                </td>
                <td className="py-2 pr-4">
                  <button onClick={addLine} className="rounded-lg border border-border px-3 py-1 text-sm">
                    Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          {error && <p className="mt-3 text-sm text-error">{error}</p>}
          {message && <p className="mt-3 text-sm text-success">{message}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting || lines.length === 0}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Placing order..." : "Place order"}
          </button>
        </Card>

        <Card color="zinc" className="overflow-x-auto">
          <h2 className="mb-3 text-lg font-semibold">My orders</h2>
          {orders.length === 0 && <p className="text-sm text-fg-muted">No orders yet.</p>}
          <div className="flex flex-col gap-4">
            {orders.map((order) => {
              const canCancel =
                (order.status === "open" || order.status === "partially_served") &&
                order.lines.every((l) => l.qty_served === 0);
              return (
                <div key={order.order_no} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">Order #{order.order_no}</span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                        {STATUS_LABELS[order.status]}
                      </span>
                      {canCancel && (
                        <button
                          onClick={() => handleCancel(order.order_no)}
                          className="text-xs text-error hover:underline"
                        >
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
