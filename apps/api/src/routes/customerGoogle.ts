import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { customersRepo } from "../repositories/customers.js";
import { customerGoogleTicketsRepo } from "../repositories/customerGoogleTickets.js";
import { verifyPassword } from "../services/auth.js";
import { resolveGoogleCustomer } from "../services/customerGoogle.js";

export default async function customerGoogleRoutes(app: FastifyInstance) {
  app.post<{ Body: { ticket?: string; password?: string; kind?: string } }>("/customer/auth/google/complete", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { ticket, password, kind } = request.body ?? {};
    if (!ticket || (kind !== "login" && kind !== "link")) return reply.code(400).send({ error: "Start again with Google" });
    const found = customerGoogleTicketsRepo.find(ticket, kind);
    if (!found) return reply.code(400).send({ error: "This sign-in has expired. Please start again." });
    const customer = customersRepo.getWithAuth(found.customer_code);
    const resolved = resolveGoogleCustomer({ sub: found.google_sub, email: found.email });
    if (!customer || resolved?.customer.code !== customer.code || resolved.kind !== kind) {
      return reply.code(401).send({ error: "This customer account cannot use this Google sign-in. Contact the station." });
    }
    if (kind === "link") {
      if (customerGoogleTicketsRepo.failedAttemptsSince(customer.code, Date.now() - 15 * 60_000) >= 5) {
        return reply.code(429).send({ error: "Too many incorrect passwords. Wait 15 minutes or contact the station." });
      }
      if (!password || !customer.password_hash || !verifyPassword(password, customer.password_hash)) {
        customerGoogleTicketsRepo.recordFailedAttempt(found.hash);
        return reply.code(401).send({ error: "Enter your existing PetroPro customer password to link Google." });
      }
      // UNIQUE google_sub prevents a Google account from linking to another customer.
      try {
        const changed = db.prepare("UPDATE customers SET google_sub = ? WHERE code = ? AND google_sub IS NULL").run(found.google_sub, customer.code);
        if (changed.changes !== 1) return reply.code(409).send({ error: "Account link changed. Start again." });
      } catch { return reply.code(409).send({ error: "Google account is already linked. Contact the station." }); }
    }
    if (!customerGoogleTicketsRepo.consume(found.hash)) return reply.code(400).send({ error: "This sign-in has already been used." });
    const token = app.jwt.sign({ sub: customer.code, role: "customer", name: customer.name }, { expiresIn: "8h" });
    return { token, customer: { code: customer.code, name: customer.name } };
  });
}
