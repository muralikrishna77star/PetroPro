import crypto from "node:crypto";
import { db } from "../db/client.js";

export type GoogleTicketKind = "login" | "link";

export interface GoogleTicket {
  hash: string;
  kind: GoogleTicketKind;
  user_id: string;
  google_sub: string;
  email: string;
  expires_at: number;
  attempts: number;
  consumed_at: number | null;
  created_at: number;
}

const hashTicket = (ticket: string) => crypto.createHash("sha256").update(ticket).digest("hex");

/**
 * Short-lived, single-use proof that Google just vouched for someone, carried from the OAuth
 * callback to the web app. "login" turns into a session. "link" needs the PetroPro password too.
 */
export const googleTicketsRepo = {
  create(input: { kind: GoogleTicketKind; user_id: string; google_sub: string; email: string; ttlMs: number }, now = Date.now()): string {
    const ticket = crypto.randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM google_tickets WHERE expires_at < ?").run(now - 24 * 60 * 60 * 1000);
    db.prepare(
      "INSERT INTO google_tickets (hash, kind, user_id, google_sub, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(hashTicket(ticket), input.kind, input.user_id, input.google_sub, input.email, now + input.ttlMs, now);
    return ticket;
  },

  /** An unexpired, unused ticket of this kind. */
  find(ticket: string, kind: GoogleTicketKind, now = Date.now()): GoogleTicket | undefined {
    return db
      .prepare("SELECT * FROM google_tickets WHERE hash = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?")
      .get(hashTicket(ticket), kind, now) as GoogleTicket | undefined;
  },

  /** True for whichever caller got there first, so a ticket can only ever be spent once. */
  consume(hash: string, now = Date.now()): boolean {
    return db.prepare("UPDATE google_tickets SET consumed_at = ? WHERE hash = ? AND consumed_at IS NULL").run(now, hash).changes === 1;
  },

  recordFailedAttempt(hash: string): void {
    db.prepare("UPDATE google_tickets SET attempts = attempts + 1 WHERE hash = ?").run(hash);
  },

  /** Wrong passwords against this user across all tickets since a time, so restarting the Google step doesn't reset the count. */
  failedAttemptsSince(userId: string, since: number): number {
    const row = db.prepare("SELECT COALESCE(SUM(attempts), 0) AS n FROM google_tickets WHERE user_id = ? AND created_at >= ?").get(userId, since) as { n: number };
    return Number(row.n);
  },
};
