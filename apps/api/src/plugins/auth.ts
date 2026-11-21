import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { authSessionsRepo } from "../repositories/authSessions.js";
import type { Role, User } from "../repositories/users.js";
import { createSession, refreshCookie } from "../services/sessions.js";

/** A staff access token. Short-lived, and only good while session `sid` and its user stay live. */
export interface AuthTokenPayload {
  sub: string;
  role: Role;
  name: string;
  sid: string;
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
    signAccessToken: (user: Pick<User, "user_id" | "role" | "name">, sessionId: string) => string;
    startStaffSession: (
      request: FastifyRequest,
      reply: FastifyReply,
      user: Pick<User, "user_id" | "role" | "name" | "billing_only">,
      method: "password" | "google",
    ) => { token: string; user: { user_id: string; name: string; role: Role; billing_only: boolean } };
  }
}

/**
 * What a "Billing screen only" cashier may call: what the Billing screen and its print, share and
 * offline parts use, and nothing else. Close Day isn't here on purpose: it closes the whole
 * station's day, which a tablet at the pumps shouldn't do. Sign-in routes don't authenticate.
 */
export const BILLING_ONLY_ROUTES = new Set([
  "GET /items",
  "GET /pumps",
  "GET /customers",
  "GET /customers/:code",
  "GET /orders",
  "GET /settings",
  "GET /tenant",
  "GET /business-date",
  "POST /bills",
  "GET /bills/recent",
  "GET /bills/:billNo",
  "POST /bills/:billNo/cancel",
  "GET /bills/:billNo/pdf",
  "GET /bills/:billNo/share-link",
  "GET /bills/:billNo/receipt",
  "GET /bills/:billNo/receipt.pdf",
  "GET /bills/:billNo/print-jobs",
  "POST /bills/:billNo/print-jobs",
  "POST /print-jobs/:id/retry",
  "PATCH /print-jobs/:id",
  "GET /print/terminals/:id",
  "POST /print/stations/:id/work",
  "PATCH /print/station-tests/:id",
  "GET /communication/settings",
  "GET /communication/log",
  "POST /communication/log",
]);

export const BILLING_ONLY_REFUSAL = "This account can only use the Billing screen";

/**
 * Whether this verified staff token's session and user are still live, right now. Tokens from
 * before sessions existed have no `sid` and are refused. Role and name are taken from the database,
 * so a role change applies from the next request rather than whenever the token runs out. So does
 * "Billing screen only": a call that screen doesn't make is "restricted".
 */
function applyLiveSession(request: FastifyRequest): "ok" | "ended" | "restricted" {
  const claims = request.user;
  if (claims.role === "customer" || claims.role === "invoice" || !claims.sid) return "ended";
  const live = authSessionsRepo.liveUser(claims.sid, claims.sub, Date.now());
  if (!live) return "ended";
  request.user = { ...claims, role: live.role, name: live.name };
  if (live.billing_only && !BILLING_ONLY_ROUTES.has(`${request.method} ${request.routeOptions.url}`)) return "restricted";
  return "ok";
}

async function authPlugin(fastify: FastifyInstance) {
  await fastify.register(jwt, { secret: config.jwtSecret });

  fastify.decorate("signAccessToken", (user: Pick<User, "user_id" | "role" | "name">, sessionId: string) =>
    fastify.jwt.sign(
      { sub: user.user_id, role: user.role, name: user.name, sid: sessionId },
      { expiresIn: config.accessTokenTtlSeconds },
    ),
  );

  fastify.decorate(
    "startStaffSession",
    (request: FastifyRequest, reply: FastifyReply, user: Pick<User, "user_id" | "role" | "name" | "billing_only">, method: "password" | "google") => {
      const { sessionId, refreshToken } = createSession(user.user_id, method, request.headers["user-agent"]);
      auditLogsRepo.record({
        user_id: user.user_id,
        action: "login",
        entity_type: "user",
        entity_id: user.user_id,
        details: { method, session: sessionId },
      });
      reply.header("Set-Cookie", refreshCookie(refreshToken));
      return {
        token: fastify.signAccessToken(user, sessionId),
        user: { user_id: user.user_id, name: user.name, role: user.role, billing_only: user.billing_only === 1 },
      };
    },
  );

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
      return;
    }
    const live = applyLiveSession(request);
    if (live === "ended") reply.code(401).send({ error: "Unauthorized" });
    else if (live === "restricted") reply.code(403).send({ error: BILLING_ONLY_REFUSAL });
  });

  fastify.decorate("requireRole", (...roles: Role[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }
      if (request.user.role === "customer" || request.user.role === "invoice") {
        reply.code(403).send({ error: "Forbidden" });
        return;
      }
      const live = applyLiveSession(request);
      if (live === "ended") {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }
      if (live === "restricted") {
        reply.code(403).send({ error: BILLING_ONLY_REFUSAL });
        return;
      }
      if (!roles.includes(request.user.role)) {
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
