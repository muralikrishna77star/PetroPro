import { db } from "../db/client.js";

export interface AuditLog {
  id: number;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  created_at: string;
}

export interface AuditLogInput {
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | number | null;
  details?: unknown;
}

export const auditLogsRepo = {
  list(filter: { userId?: string; entityType?: string } = {}, limit = 200): AuditLog[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.userId) {
      clauses.push("user_id = ?");
      params.push(filter.userId);
    }
    if (filter.entityType) {
      clauses.push("entity_type = ?");
      params.push(filter.entityType);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db
      .prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit) as unknown as AuditLog[];
  },

  record(input: AuditLogInput): void {
    db.prepare(
      "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)",
    ).run(
      input.user_id,
      input.action,
      input.entity_type,
      input.entity_id !== undefined && input.entity_id !== null ? String(input.entity_id) : null,
      input.details !== undefined ? JSON.stringify(input.details) : null,
    );
  },
};
