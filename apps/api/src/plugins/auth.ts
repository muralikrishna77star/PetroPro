import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import type { Role } from "../repositories/users.js";

export interface AuthTokenPayload {
  sub: string;
  role: Role;
  name: string;
}

/** A customer's own login — a separate audience from staff, not a 5th `Role` value, so it
 *  can never accidentally satisfy a staff `requireRole(...)` allow-list. `sub` is the
 *  customer's `code`. */
export interface CustomerTokenPayload {
  sub: string;
  role: "customer";
  name: string;
}

/** A single-bill, time-limited link (QR-code invoice sharing — see routes/publicInvoice.ts) —
 *  a third audience, distinct from both staff and customer sessions. `sub` is the bill number
 *  as a string; a token only ever grants access to that one bill, never a customer's full
 *  history or account. Short `expiresIn` (set where it's signed, routes/bills.ts) is the only
 *  access control here — anyone holding a valid link can view/download that one invoice, same
 *  as anyone holding the printed paper copy. */
export interface InvoiceTokenPayload {
  sub: string;
  role: "invoice";
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthTokenPayload | CustomerTokenPayload | InvoiceTokenPayload;
    user: AuthTokenPayload | CustomerTokenPayload | InvoiceTokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateCustomer: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  await fastify.register(jwt, { secret: config.jwtSecret });

  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    // A valid JWT alone isn't enough — this decorator is staff-only. Without this check, a
    // customer-portal token (or, since InvoiceTokenPayload was added, a QR-code single-bill
    // token handed to any walk-in) would satisfy every route gated with plain `authenticate`
    // (e.g. GET /bills/recent, GET /bills/:billNo/pdf for an arbitrary bill number) — not just
    // the one bill/account it was actually scoped to. Customer/invoice-scoped access always goes
    // through their own dedicated decorator or route instead (authenticateCustomer,
    // routes/publicInvoice.ts's own token check).
    if (request.user.role === "customer" || request.user.role === "invoice") {
      reply.code(403).send({ error: "Forbidden" });
    }
  });

  fastify.decorate("requireRole", (...roles: Role[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }
      if (request.user.role === "customer" || request.user.role === "invoice" || !roles.includes(request.user.role)) {
        reply.code(403).send({ error: "Forbidden" });
      }
    };
  });

  fastify.decorate("authenticateCustomer", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    if (request.user.role !== "customer") {
      reply.code(403).send({ error: "Forbidden" });
    }
  });
}

export default fp(authPlugin);
