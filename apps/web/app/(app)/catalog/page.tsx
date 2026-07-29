"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Group, type Item, type ItemInput } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { Combobox } from "@/components/ui/Combobox";

export default function CatalogPage() {
  const session = useRequireSession(["super_admin", "owner"]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-4 py-8">
        {session && (
          <>
            <GroupsSection token={session.token} />
            <ItemsSection token={session.token} />
          </>
        )}
      </div>
    </div>
  );
}

function GroupsSection({ token }: { token: string }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.listGroups(token).then(setGroups).catch(() => undefined);
  }

  useEffect(refresh, [token]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createGroup(token, { code, name });
      setCode("");
      setName("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create group");
    }
  }

  async function handleSaveEdit(groupCode: string) {
    setError(null);
    try {
      await api.updateGroup(token, groupCode, editingName);
      setEditingCode(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update group");
    }
  }

  return (
    <Card color="emerald">
      <h1 className="mb-4 text-xl font-semibold text-primary">Groups</h1>

      <form onSubmit={handleCreate} className="mb-4 flex gap-2">
        <input
          placeholder="Code"
          className="w-24 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <input
          placeholder="Name"
          className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">Add</button>
      </form>
      {error && <p className="mb-3 text-sm text-error">{error}</p>}

      <ul className="flex flex-col gap-1 text-sm">
        {groups.map((g) => (
          <li key={g.code} className="flex items-center gap-2 rounded bg-card-hover px-3 py-1.5 bg-bg-elevated">
            <span className="w-16 font-mono">{g.code}</span>
            {editingCode === g.code ? (
              <>
                <input
                  className="flex-1 rounded border border-border px-2 py-1 text-sm  "
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                />
                <button onClick={() => handleSaveEdit(g.code)} className="text-success">
                  Save
                </button>
                <button onClick={() => setEditingCode(null)} className="text-fg-muted">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">{g.name}</span>
                <button
                  onClick={() => {
                    setEditingCode(g.code);
                    setEditingName(g.name);
                  }}
                  className="text-fg-muted underline"
                >
                  Edit
                </button>
              </>
            )}
          </li>
        ))}
        {groups.length === 0 && <li className="text-fg-muted">No groups yet.</li>}
      </ul>
    </Card>
  );
}

const emptyItemForm: ItemInput = {
  code: "",
  name: "",
  group_code: "",
  price_wholesale: 0,
  price_retail: 0,
  purchase_value: 0,
  track_mileage: false,
  tax_percent: 0,
  hsn_code: "",
};

// GST invoicing rules (CBIC notification 78/2020): HSN codes are numeric, 4/6/8 digits long.
const HSN_CODE_PATTERN = /^\d{4}$|^\d{6}$|^\d{8}$/;
const HSN_ERROR = "HSN code must be 4, 6, or 8 digits";

function ItemsSection({ token }: { token: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState<ItemInput>(emptyItemForm);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refresh() {
    api.listItems(token).then(setItems).catch(() => undefined);
  }

  useEffect(() => {
    refresh();
    api.listGroups(token).then(setGroups).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function startEdit(item: Item) {
    setEditingCode(item.code);
    setForm({
      code: item.code,
      name: item.name,
      group_code: item.group_code ?? "",
      price_wholesale: item.price_wholesale,
      price_retail: item.price_retail,
      purchase_value: item.purchase_value,
      track_mileage: item.track_mileage === 1,
      tax_percent: item.tax_percent,
      hsn_code: item.hsn_code ?? "",
    });
  }

  function startCreate() {
    setEditingCode(null);
    setForm(emptyItemForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const hsnCode = (form.hsn_code ?? "").trim();
    if (hsnCode && !HSN_CODE_PATTERN.test(hsnCode)) {
      setError(HSN_ERROR);
      return;
    }
    setSaving(true);
    try {
      const body: ItemInput = {
        ...form,
        group_code: form.group_code || null,
        price_wholesale: Number(form.price_wholesale) || 0,
        price_retail: Number(form.price_retail) || 0,
        purchase_value: Number(form.purchase_value) || 0,
        tax_percent: Number(form.tax_percent) || 0,
        hsn_code: hsnCode || null,
      };
      if (editingCode) {
        await api.updateItem(token, editingCode, body);
      } else {
        await api.createItem(token, body);
      }
      startCreate();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card color="emerald">
      <h2 className="mb-4 text-lg font-semibold">{editingCode ? `Edit item ${editingCode}` : "Add Item"}</h2>

      <form onSubmit={handleSubmit} className="mb-6 flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            placeholder="Code"
            className="w-24 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-60  bg-bg-elevated"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            disabled={!!editingCode}
            required
          />
          <input
            placeholder="Name"
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <Combobox
            options={groups.map((g) => ({ value: g.code, label: g.name }))}
            value={form.group_code ?? ""}
            onChange={(value) => setForm({ ...form, group_code: value })}
            placeholder="No group"
            className="w-40"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col text-xs text-fg-muted">
            Wholesale price
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-28 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={form.price_wholesale}
              onChange={(e) => setForm({ ...form, price_wholesale: Number(e.target.value) })}
              required
            />
          </label>
          <label className="flex flex-col text-xs text-fg-muted">
            Retail price
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-28 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={form.price_retail}
              onChange={(e) => setForm({ ...form, price_retail: Number(e.target.value) })}
              required
            />
          </label>
          <label className="flex flex-col text-xs text-fg-muted">
            Purchase value
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-28 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={form.purchase_value}
              onChange={(e) => setForm({ ...form, purchase_value: Number(e.target.value) })}
              required
            />
          </label>
          <label className="flex flex-col text-xs text-fg-muted">
            Tax %
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-20 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={form.tax_percent}
              onChange={(e) => setForm({ ...form, tax_percent: Number(e.target.value) })}
              required
            />
          </label>
          <label className="flex flex-col text-xs text-fg-muted">
            HSN code
            <input
              placeholder="e.g. 271019"
              inputMode="numeric"
              maxLength={8}
              title={HSN_ERROR}
              className="w-28 rounded-lg border border-border px-3 py-2 text-sm  bg-bg-elevated"
              value={form.hsn_code ?? ""}
              onChange={(e) => setForm({ ...form, hsn_code: e.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label className="flex items-end gap-1.5 pb-2 text-sm">
            <input
              type="checkbox"
              checked={!!form.track_mileage}
              onChange={(e) => setForm({ ...form, track_mileage: e.target.checked })}
            />
            Track mileage (fuel item)
          </label>
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex gap-2">
          <button
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : editingCode ? "Save changes" : "Add item"}
          </button>
          {editingCode && (
            <button type="button" onClick={startCreate} className="rounded-lg border border-border px-4 py-2 text-sm ">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border ">
              <th className="py-2 pr-4">Code</th>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Group</th>
              <th className="py-2 pr-4">Retail</th>
              <th className="py-2 pr-4">Tax %</th>
              <th className="py-2 pr-4">HSN</th>
              <th className="py-2 pr-4">Mileage</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.code} className="border-b border-border ">
                <td className="py-2 pr-4 font-mono">{item.code}</td>
                <td className="py-2 pr-4">{item.name}</td>
                <td className="py-2 pr-4">{item.group_code ?? "—"}</td>
                <td className="py-2 pr-4">₹{item.price_retail.toFixed(2)}</td>
                <td className="py-2 pr-4">{item.tax_percent}%</td>
                <td className="py-2 pr-4 font-mono">{item.hsn_code ?? "—"}</td>
                <td className="py-2 pr-4">{item.track_mileage ? "Yes" : "No"}</td>
                <td className="py-2 pr-4">
                  <button onClick={() => startEdit(item)} className="text-fg-muted underline">
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-center text-fg-muted">
                  No items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
