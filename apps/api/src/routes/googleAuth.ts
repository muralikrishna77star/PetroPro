import type { FastifyInstance } from "fastify";
import { customerGoogleCallback } from "../services/customerGoogle.js";
import { config } from "../config.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { googleTicketsRepo } from "../repositories/googleTickets.js";
import { usersRepo } from "../repositories/users.js";
import { verifyPassword } from "../services/auth.js";
import {
  UnverifiedEmailError,
  clearedFlowCookie,
  exchangeCode,
  readFlow,
  resolveGoogleUser,
  startFlow,
  verifyIdToken,
} from "../services/googleOAuth.js";

const LOGIN_TICKET_TTL_MS = 60 * 1000;
const LINK_TICKET_TTL_MS = 10 * 60 * 1000;
const LINK_LOCK_WINDOW_MS = 15 * 60 * 1000;
const LINK_MAX_FAILED_PASSWORDS = 5;

function googleConfigured(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

/**
 * Google Sign-In for staff — additive to the existing user-id/password login (routes/auth.ts),
 * never a replacement. Google only ever proves who someone is: which PetroPro user that is, and
 * their role, come from this database (services/googleOAuth.ts). No user is ever created here,
 * and a matching email alone never links: the first time also takes that user's PetroPro password.
 */
export default async function googleAuthRoutes(fastify: FastifyInstance) {
  fastify.get("/auth/google/customer", async (_request, reply) => {
    if (!googleConfigured()) return reply.code(501).send({ error: "Google Sign-In is not configured on this server" });
    const { authUrl, cookie } = startFlow("customer");
    return reply.header("Set-Cookie", cookie).redirect(authUrl);
  });

  fastify.get("/auth/google", async (_request, reply) => {
    if (!googleConfigured()) {
      return reply.code(501).send({ error: "Google Sign-In is not configured on this server" });
    }
    const { authUrl, cookie } = startFlow();
    return reply.header("Set-Cookie", cookie).redirect(authUrl);
  });

  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/callback",
    // Quieter than the default info level: request logging would write the one-time code to the logs.
    { logLevel: "warn" },
    async (request, reply) => {
      if (!googleConfigured()) {
        return reply.code(501).send({ error: "Google Sign-In is not configured on this server" });
      }
      reply.header("Set-Cookie", clearedFlowCookie());
      const flow = readFlow(request.headers.cookie, request.query.state);
      const loginPath = flow?.audience === "customer" ? "/customer/login" : "/login";
      const fail = (reason: string) => reply.redirect(`${config.webAppUrl}${loginPath}?error=${reason}`);

      const { code, error } = request.query;
      if (!flow) return fail("google_failed");
      if (error) return fail(error === "access_denied" ? "google_cancelled" : "google_failed");
      if (!code) return fail("google_failed");

      try {
        const identity = await verifyIdToken(await exchangeCode(code, flow.verifier), flow.nonce);
        if (flow.audience === "customer") return customerGoogleCallback(reply, identity);
        const result = resolveGoogleUser(identity);
        if ("denied" in result) {
          auditLogsRepo.record({
            user_id: null,
            action: "google_login_denied",
            entity_type: "user",
            details: { reason: result.denied, email: identity.email },
          });
          return fail(result.denied);
        }

        // The cookie that keeps a session is set on the web app's own origin, so the browser
        // collects it there. A single-use ticket makes that hand-over, in the URL fragment so it
        // never lands in server access logs.
        const kind = "linkRequired" in result ? "link" : "login";
        const ticket = googleTicketsRepo.create({
          kind,
          user_id: result.user.user_id,
          google_sub: identity.sub,
          email: identity.email,
          ttlMs: kind === "link" ? LINK_TICKET_TTL_MS : LOGIN_TICKET_TTL_MS,
        });
        const fragment = new URLSearchParams(kind === "link" ? { link: ticket, email: identity.email } : { handoff: ticket });
        return reply.redirect(`${config.webAppUrl}/login/callback#${fragment}`);
      } catch (err) {
        if (err instanceof UnverifiedEmailError) return fail("email_unverified");
        // The message only: never the request, which holds the code, or anything Google returned.
        request.log.warn({ reason: (err as Error).message }, "Google sign-in failed");
        return fail("google_failed");
      }
    },
  );

  // An already-linked user finishing their sign-in.
  fastify.post<{ Body: { ticket?: string } }>("/auth/google/exchange", async (request, reply) => {
    const found = request.body?.ticket ? googleTicketsRepo.find(request.body.ticket, "login") : undefined;
    if (!found || !googleTicketsRepo.consume(found.hash)) {
      return reply.code(400).send({ error: "This sign-in has expired. Please try again." });
    }
    const user = usersRepo.getById(found.user_id);
    if (!user || !user.active || user.google_sub !== found.google_sub) {
      return reply.code(401).send({ error: "This account can't sign in with Google" });
    }
    return fastify.startStaffSession(request, reply, user, "google");
  });

  // First sign-in with a Google account: the PetroPro password proves this person owns the user too.
  fastify.post<{ Body: { ticket?: string; password?: string } }>("/auth/google/link", async (request, reply) => {
    const { ticket, password } = request.body ?? {};
    if (!ticket || !password) return reply.code(400).send({ error: "Your password is required" });

    const found = googleTicketsRepo.find(ticket, "link");
    if (!found) return reply.code(400).send({ error: "This confirmation has expired. Please start again with Google." });

    const denied = (reason: string) =>
      auditLogsRepo.record({ user_id: null, action: "google_link_denied", entity_type: "user", entity_id: found.user_id, details: { reason, email: found.email } });

    if (googleTicketsRepo.failedAttemptsSince(found.user_id, Date.now() - LINK_LOCK_WINDOW_MS) >= LINK_MAX_FAILED_PASSWORDS) {
      denied("too_many_attempts");
      return reply.code(429).send({ error: "Too many incorrect passwords. Please wait 15 minutes, or ask your administrator." });
    }

    const user = usersRepo.getById(found.user_id);
    if (!user || !user.active) {
      denied("account_inactive");
      return reply.code(401).send({ error: "This PetroPro account has been deactivated." });
    }
    if (!verifyPassword(password, user.password_hash)) {
      googleTicketsRepo.recordFailedAttempt(found.hash);
      denied("incorrect_password");
      return reply.code(401).send({ error: "Incorrect password. Please try again." });
    }

    // The database refuses a user already linked, or a Google account already on someone else.
    if (!googleTicketsRepo.consume(found.hash) || !usersRepo.linkGoogle(user.user_id, found.google_sub)) {
      denied("account_conflict");
      return reply.code(409).send({ error: "This account or Google account is already linked. Please ask your administrator." });
    }
    auditLogsRepo.record({
      user_id: user.user_id,
      action: "google_account_linked",
      entity_type: "user",
      entity_id: user.user_id,
      details: { email: found.email, confirmed_by: "password" },
    });
    return fastify.startStaffSession(request, reply, user, "google");
  });
}
