"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type AppUser } from "@/lib/api";
import type { Role } from "@/lib/auth";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";

const ROLES: Role[] = ["super_admin", "owner", "operator", "field_operator"];

export default function UsersPage() {
  const session = useRequireSession(["super_admin"]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<Role>("operator");
  const [editEmail, setEditEmail] = useState("");

  function refresh(token: string) {
    api.listUsers(token).then(setUsers).catch(() => undefined);
  }

  useEffect(() => {
    if (!session) return;
    refresh(session.token);
  }, [session]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setError(null);
    setNotice(null);
    try {
      const created = await api.createUser(session.token, { user_id: userId, name, role, email: email || null });
      setUserId("");
      setName("");
      setRole("operator");
      setEmail("");
      refresh(session.token);
      if (created.temporaryPassword) {
        setNotice(`Created ${created.user_id} — temporary password: ${created.temporaryPassword} (shown once)`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create user");
    }
  }

  function startEdit(user: AppUser) {
    setEditingId(user.user_id);
    setEditName(user.name);
    setEditRole(user.role);
    setEditEmail(user.email ?? "");
  }

  async function saveEdit(id: string) {
    if (!session) return;
    setError(null);
    try {
      await api.updateUser(session.token, id, { name: editName, role: editRole, email: editEmail || null });
      setEditingId(null);
      refresh(session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update user");
    }
  }

  async function toggleActive(user: AppUser) {
    if (!session) return;
    setError(null);
    try {
      if (user.active) {
        await api.deactivateUser(session.token, user.user_id);
      } else {
        await api.reactivateUser(session.token, user.user_id);
      }
      refresh(session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change account status");
    }
  }

  async function resetPassword(user: AppUser) {
    if (!session) return;
    setError(null);
    setNotice(null);
    try {
      const result = await api.resetUserPassword(session.token, user.user_id);
      setNotice(`New temporary password for ${result.user_id}: ${result.temporaryPassword} (shown once)`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset password");
    }
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-semibold text-primary">Users</h1>

        <Card color="teal" as="form" onSubmit={handleCreate} className="flex flex-wrap gap-2">
          <input
            placeholder="User ID"
            className="w-32 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
          />
          <input
            placeholder="Name"
            className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="email"
            placeholder="Email (optional — enables Google sign-in)"
            className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white">Add user</button>
        </Card>

        {error && <p className="text-sm text-error">{error}</p>}
        {notice && (
          <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success   ">
            {notice}
          </p>
        )}

        <Card color="teal" className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border ">
                <th className="py-2 pr-4">User ID</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-b border-border ">
                  <td className="py-2 pr-4 font-mono">{u.user_id}</td>
                  {editingId === u.user_id ? (
                    <>
                      <td className="py-2 pr-4">
                        <input
                          className="w-full rounded border border-border px-2 py-1 text-sm  bg-bg-elevated"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="email"
                          placeholder="Email (optional)"
                          className="w-full rounded border border-border px-2 py-1 text-sm  bg-bg-elevated"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <select
                          className="rounded border border-border px-2 py-1 text-sm  bg-bg-elevated"
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as Role)}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-4">{u.active ? "Active" : "Inactive"}</td>
                      <td className="py-2 pr-4">{u.created_at}</td>
                      <td className="flex gap-2 py-2 pr-4">
                        <button onClick={() => saveEdit(u.user_id)} className="text-success">
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-fg-muted">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-4">{u.name}</td>
                      <td className="py-2 pr-4 text-fg-muted">{u.email ?? "—"}</td>
                      <td className="py-2 pr-4">{u.role}</td>
                      <td className="py-2 pr-4">
                        <span className={u.active ? "text-success" : "text-error"}>
                          {u.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-2 pr-4">{u.created_at}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => startEdit(u)} className="text-fg-muted underline">
                            Edit
                          </button>
                          <button onClick={() => resetPassword(u)} className="text-fg-muted underline">
                            Reset password
                          </button>
                          {u.user_id !== session.userId && (
                            <button
                              onClick={() => toggleActive(u)}
                              className={u.active ? "text-error underline" : "text-success underline"}
                            >
                              {u.active ? "Deactivate" : "Reactivate"}
                            </button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-fg-muted">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
