"use client";

import { useEffect, useState } from "react";
import { api, type AuditLog } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";

export default function AuditLogsPage() {
  const session = useRequireSession(["super_admin", "owner"]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [userFilter, setUserFilter] = useState("");

  function refresh(token: string, userId?: string) {
    api.listAuditLogs(token, { userId: userId || undefined }).then(setLogs).catch(() => undefined);
  }

  useEffect(() => {
    if (!session) return;
    refresh(session.token);
  }, [session]);

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <h1 className="text-xl font-semibold text-primary">Audit Logs</h1>

        <div className="flex gap-2">
          <input
            placeholder="Filter by user ID"
            className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          />
          <button
            onClick={() => refresh(session.token, userFilter)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm "
          >
            Filter
          </button>
        </div>

        <Card color="teal" className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border ">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Entity</th>
                <th className="py-2 pr-4">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-border  align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{log.created_at}</td>
                  <td className="py-2 pr-4">{log.user_id ?? "—"}</td>
                  <td className="py-2 pr-4">{log.action}</td>
                  <td className="py-2 pr-4">
                    {log.entity_type}
                    {log.entity_id ? ` #${log.entity_id}` : ""}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-fg-muted">{log.details ?? "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-fg-muted">
                    No audit log entries.
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
