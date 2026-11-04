import { db } from "../db/client.js";
import type { Role } from "@petropro/shared-types";

export interface AuthSession {
  id: string;
  user_id: string;
  refresh_hash: string;
  previous_hash: string | null;
  rotated_at: number;
  login_method: string;
  user_agent: string | null;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  revoked_at: number | null;
  revoke_reason: string | null;
}

/** Times are epoch milliseconds. Only hashes of refresh tokens are stored. */
export const authSessionsRepo = {
  create(input: Pick<AuthSession, "id" | "user_id" | "refresh_hash" | "login_method" | "user_agent" | "expires_at">, now: number): void {
    db.prepare(
      `INSERT INTO auth_sessions (id, user_id, refresh_hash, rotated_at, login_method, user_agent, created_at, last_used_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.user_id, input.refresh_hash, now, input.login_method, input.user_agent, now, now, input.expires_at);
  },

  get(id: string): AuthSession | undefined {
    return db.prepare("SELECT * FROM auth_sessions WHERE id = ?").get(id) as AuthSession | undefined;
  },

  /** The current role and name if this session and its user are both still live, else undefined.
   *  Runs on every staff API request: this is what makes revocation immediate. */
  liveUser(sessionId: string, userId: string, now: number): { role: Role; name: string } | undefined {
    return db
      .prepare(
        `SELECT u.role, u.name FROM auth_sessions s JOIN users u ON u.user_id = s.user_id
         WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.active = 1`,
      )
      .get(sessionId, userId, now) as { role: Role; name: string } | undefined;
  },

  rotate(id: string, refreshHash: string, previousHash: string, now: number): void {
    db.prepare("UPDATE auth_sessions SET refresh_hash = ?, previous_hash = ?, rotated_at = ?, last_used_at = ? WHERE id = ?").run(
      refreshHash,
      previousHash,
      now,
      now,
      id,
    );
  },

  revoke(id: string, reason: string, now: number): boolean {
    return (
      db.prepare("UPDATE auth_sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL").run(now, reason, id).changes === 1
    );
  },

  /** How many live sessions were ended. */
  revokeAllForUser(userId: string, reason: string, now: number): number {
    return Number(
      db.prepare("UPDATE auth_sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, reason, userId).changes,
    );
  },

  /** Drops rows long past use. The audit log keeps the history. */
  prune(before: number): void {
    db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(before);
  },
};
