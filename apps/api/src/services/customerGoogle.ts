import type { FastifyReply } from "fastify";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { customerGoogleTicketsRepo } from "../repositories/customerGoogleTickets.js";
import type { CustomerWithAuth } from "../repositories/customers.js";
import type { GoogleIdentity } from "./googleOAuth.js";

/** Fail closed on duplicate registered addresses; Google subject is the durable identity. */
export function resolveGoogleCustomer(identity: GoogleIdentity) {
  const linked = db.prepare("SELECT * FROM customers WHERE google_sub = ?").get(identity.sub) as CustomerWithAuth | undefined;
  if (linked) return { customer: linked, kind: "login" as const };
  const matches = db.prepare("SELECT * FROM customers WHERE lower(trim(email)) = ?").all(identity.email) as unknown as CustomerWithAuth[];
  if (matches.length !== 1 || matches[0].google_sub || !matches[0].password_hash) return null;
  return { customer: matches[0], kind: "link" as const };
}

export function customerGoogleCallback(reply: FastifyReply, identity: GoogleIdentity) {
  const result = resolveGoogleCustomer(identity);
  if (!result) return reply.redirect(`${config.webAppUrl}/customer/login?error=google_not_registered`);
  const ticket = customerGoogleTicketsRepo.create({
    kind: result.kind, customer_code: result.customer.code, google_sub: identity.sub,
    email: identity.email, ttlMs: result.kind === "link" ? 10 * 60_000 : 60_000,
  });
  return reply.redirect(`${config.webAppUrl}/customer/login/callback#${new URLSearchParams({ ticket, kind: result.kind })}`);
}
