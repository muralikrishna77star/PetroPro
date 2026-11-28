"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Customer, type Vehicle, type VehicleNearMatchGroup } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { vehicleKey } from "@/lib/vehicles";
import { Card } from "@/components/Card";
import { SectionLabel } from "@/components/SectionLabel";
import { Combobox } from "@/components/ui/Combobox";

const MAX_ROWS = 200;

/** Maintenance → Vehicles: the vehicle master. Billing and the customer Purchase Order screen add
 *  new numbers here on their own; this is where owners get corrected and near-duplicate numbers
 *  (the same vehicle keyed in different ways) get merged, which also corrects their bills. */
export default function VehiclesPage() {
  const session = useRequireSession(["super_admin", "owner", "operator"]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");

  const [newNo, setNewNo] = useState("");
  const [newCustomer, setNewCustomer] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addMessage, setAddMessage] = useState<string | null>(null);

  const [editingNo, setEditingNo] = useState<string | null>(null);
  const [editCustomer, setEditCustomer] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!session) return;
    api.listVehicles(session.token).then(setVehicles).catch(() => undefined);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refresh();
    api.listCustomers(session.token).then(setCustomers).catch(() => undefined);
  }, [session, refresh]);

  const customerName = useMemo(() => new Map(customers.map((c) => [c.code, c.name])), [customers]);
  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })),
    [customers],
  );
  const knownCustomer = (code: string) => customers.some((c) => c.code === code.trim().toUpperCase());

  const shown = useMemo(() => {
    const key = vehicleKey(search);
    const filter = customerFilter.trim().toUpperCase();
    return vehicles.filter(
      (v) => (!key || vehicleKey(v.vehicle_no).includes(key)) && (!filter || v.customer_code === filter),
    );
  }, [vehicles, search, customerFilter]);

  async function addVehicle() {
    if (!session) return;
    setAddError(null);
    setAddMessage(null);
    if (newCustomer && !knownCustomer(newCustomer)) {
      setAddError(`No customer with code ${newCustomer}`);
      return;
    }
    try {
      const created = await api.createVehicle(session.token, {
        vehicle_no: newNo,
        customer_code: newCustomer.trim().toUpperCase() || null,
      });
      setAddMessage(`${created.vehicle_no} added.`);
      setNewNo("");
      refresh();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Couldn't add the vehicle");
    }
  }

  async function saveOwner(vehicleNo: string) {
    if (!session) return;
    setEditError(null);
    if (editCustomer && !knownCustomer(editCustomer)) {
      setEditError(`No customer with code ${editCustomer}`);
      return;
    }
    try {
      await api.setVehicleOwner(session.token, vehicleNo, editCustomer.trim().toUpperCase() || null);
      setEditingNo(null);
      refresh();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Couldn't change the owner");
    }
  }

  if (!session) return null;
  const canMerge = session.role === "super_admin" || session.role === "owner";

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-semibold text-primary">Vehicles</h1>

        <Card color="emerald" className="flex flex-col gap-3">
          <SectionLabel>Add a Vehicle</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Vehicle no."
              className="h-10 flex-1 rounded-lg border border-border bg-bg-elevated px-3 text-sm uppercase"
              value={newNo}
              onChange={(e) => setNewNo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addVehicle()}
            />
            <div className="flex-1">
              <Combobox
                options={customerOptions}
                value={newCustomer}
                onChange={setNewCustomer}
                placeholder="Customer code"
                className="uppercase"
              />
            </div>
            <button
              onClick={addVehicle}
              disabled={vehicleKey(newNo).length < 2}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          <p className="text-xs text-fg-muted">
            Numbers are saved without spaces or hyphens. Billing and customer purchase orders add new vehicles here
            automatically.
          </p>
          {addError && <p className="text-sm text-error">{addError}</p>}
          {addMessage && <p className="text-sm text-success">{addMessage}</p>}
        </Card>

        {canMerge && <NearMatchesCard token={session.token} customerName={customerName} onMerged={refresh} />}

        <Card color="emerald" className="flex flex-col gap-3 overflow-x-auto">
          <SectionLabel>Vehicle Master</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Search vehicle no."
              className="h-10 flex-1 rounded-lg border border-border bg-bg-elevated px-3 text-sm uppercase"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex-1">
              <Combobox
                options={customerOptions}
                value={customerFilter}
                onChange={setCustomerFilter}
                placeholder="Filter by customer"
                className="uppercase"
              />
            </div>
          </div>
          <p className="text-xs text-fg-muted">
            {shown.length} of {vehicles.length} vehicles{shown.length > MAX_ROWS ? ` — showing the first ${MAX_ROWS}` : ""}
          </p>
          {editError && <p className="text-sm text-error">{editError}</p>}
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-fg-muted">
                <th className="py-1.5 pr-3 font-normal">Vehicle No</th>
                <th className="py-1.5 pr-3 font-normal">Customer</th>
                <th className="py-1.5 pr-3" />
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, MAX_ROWS).map((v) => (
                <tr key={v.vehicle_no} className="border-b border-border">
                  <td className="py-1.5 pr-3 font-mono">{v.vehicle_no}</td>
                  <td className="py-1.5 pr-3">
                    {editingNo === v.vehicle_no ? (
                      <Combobox
                        options={customerOptions}
                        value={editCustomer}
                        onChange={setEditCustomer}
                        placeholder="Customer code (empty = none)"
                        className="uppercase"
                        autoFocus
                      />
                    ) : v.customer_code ? (
                      <>
                        <span className="font-mono">{v.customer_code}</span>{" "}
                        <span className="text-fg-muted">{customerName.get(v.customer_code) ?? ""}</span>
                      </>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right">
                    {editingNo === v.vehicle_no ? (
                      <span className="flex justify-end gap-3">
                        <button onClick={() => saveOwner(v.vehicle_no)} className="font-medium text-primary hover:underline">
                          Save
                        </button>
                        <button onClick={() => setEditingNo(null)} className="text-fg-muted hover:underline">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingNo(v.vehicle_no);
                          setEditCustomer(v.customer_code ?? "");
                          setEditError(null);
                        }}
                        className="text-primary hover:underline"
                      >
                        Change customer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

/** Groups of numbers that look like one vehicle. The user picks the correct number, and merging
 *  moves every bill, fuel entry, mileage entry and order from the others onto it. */
function NearMatchesCard({
  token,
  customerName,
  onMerged,
}: {
  token: string;
  customerName: Map<string, string>;
  onMerged: () => void;
}) {
  const [groups, setGroups] = useState<VehicleNearMatchGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  // The number to keep, per group (keyed by the group's first number).
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    setLoading(true);
    setError(null);
    try {
      setGroups(await api.getVehicleNearMatches(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't look for near matches");
    } finally {
      setLoading(false);
    }
  }

  async function merge(group: VehicleNearMatchGroup, id: string) {
    // The default pick is the number with the most bills (the server lists it first).
    const target = keep[id] ?? group.vehicles[0].vehicle_no;
    const others = group.vehicles.map((v) => v.vehicle_no).filter((no) => no !== target);
    if (
      !window.confirm(
        `Merge ${others.join(", ")} into ${target}? Their bills and mileage entries will show ${target}. This can't be undone.`,
      )
    )
      return;
    setBusy(id);
    setError(null);
    setMessage(null);
    try {
      const result = await api.mergeVehicles(token, target, others);
      setMessage(`Merged into ${result.kept}: ${result.bills} bill(s) and ${result.mileage_entries} mileage entr(ies) corrected.`);
      await find();
      onMerged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Merge failed");
    } finally {
      setBusy(null);
    }
  }

  async function markDistinct(group: VehicleNearMatchGroup, id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.markVehiclesDistinct(token, group.vehicles.map((v) => v.vehicle_no));
      setGroups((prev) => prev?.filter((g) => g !== group) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card color="amber" className="flex flex-col gap-3 overflow-x-auto">
      <SectionLabel>Near-Matching Vehicle Numbers</SectionLabel>
      <p className="text-sm text-fg-muted">
        Finds numbers that look like the same vehicle keyed in different ways — spaces or hyphens, one wrong or missing
        character, two characters swapped, or O/0 and I/1 mixed up. Pick the correct number and merge: the bills on the
        other numbers are corrected to it.
      </p>
      <div>
        <button
          onClick={find}
          disabled={loading}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Looking..." : groups ? "Look again" : "Find near matches"}
        </button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      {message && <p className="text-sm text-success">{message}</p>}
      {groups && groups.length === 0 && <p className="text-sm text-fg-muted">No near-matching numbers found.</p>}
      {groups?.map((group) => {
        const id = group.vehicles[0].vehicle_no;
        const target = keep[id] ?? id;
        return (
          <div key={id} className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-medium text-fg-muted">
              {group.kind === "same"
                ? "Same number, keyed differently"
                : "One character apart — check these are really the same vehicle"}
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-fg-muted">
                  <th className="py-1 pr-3 font-normal">Keep</th>
                  <th className="py-1 pr-3 font-normal">Vehicle No</th>
                  <th className="py-1 pr-3 font-normal">Customer</th>
                  <th className="py-1 pr-3 text-right font-normal">Bills</th>
                  <th className="py-1 font-normal">Last bill</th>
                </tr>
              </thead>
              <tbody>
                {group.vehicles.map((v) => (
                  <tr key={v.vehicle_no}>
                    <td className="py-1 pr-3">
                      <input
                        type="radio"
                        name={`keep-${id}`}
                        aria-label={`Keep ${v.vehicle_no}`}
                        checked={target === v.vehicle_no}
                        onChange={() => setKeep((prev) => ({ ...prev, [id]: v.vehicle_no }))}
                      />
                    </td>
                    <td className="py-1 pr-3 font-mono">{v.vehicle_no}</td>
                    <td className="py-1 pr-3">
                      {v.customer_code ? `${v.customer_code} ${customerName.get(v.customer_code) ?? ""}` : "—"}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{v.bill_count}</td>
                    <td className="py-1 text-fg-muted">{v.last_bill_date?.slice(0, 10) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => merge(group, id)}
                disabled={busy !== null}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {busy === id ? "Working..." : `Merge into ${target}`}
              </button>
              <button
                onClick={() => markDistinct(group, id)}
                disabled={busy !== null}
                className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Not the same vehicle
              </button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
