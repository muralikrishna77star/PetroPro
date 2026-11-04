import type { FastifyInstance } from "fastify";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { authSessionsRepo } from "../repositories/authSessions.js";
import { usersRepo } from "../repositories/users.js";
import { verifyPassword } from "../services/auth.js";
import {
  REFRESH_COOKIE,
  clearedRefreshCookie,
  readCookie,
  refreshCookie,
  rotateRefreshToken,
  sessionForRefreshToken,
} from "../services/sessions.js";

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { user_id: string; password: string } }>("/auth/login", async (request, reply) => {
    const { user_id, password } = request.body ?? {};
    if (!user_id || !password) {
      return reply.code(400).send({ error: "user_id and password are required" });
    }

    const user = usersRepo.getById(user_id);
    if (!user || !verifyPassword(password, user.password_hash)) {
      // What was typed is only recorded when it names a real user: it could otherwise be a mistyped password.
      auditLogsRepo.record({ user_id: null, action: "login_failed", entity_type: "user", entity_id: user?.user_id ?? null, details: { method: "password" } });
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    if (!user.active) {
      auditLogsRepo.record({ user_id: null, action: "login_denied", entity_type: "user", entity_id: user.user_id, details: { method: "password", reason: "account_inactive" } });
      return reply.code(401).send({ error: "This account has been deactivated" });
    }

    return fastify.startStaffSession(request, reply, user, "password");
  });

  // Swaps the refresh cookie for a new one and a fresh access token.
  fastify.post("/auth/refresh", async (request, reply) => {
    const result = rotateRefreshToken(readCookie(request.headers.cookie, REFRESH_COOKIE));
    if (result.status === "retry") return reply.code(409).send({ error: "Try again" });
    if (result.status === "ended") {
      if (result.reuseDetected) {
        auditLogsRepo.record({
          user_id: null,
          action: "session_revoked",
          entity_type: "user",
          entity_id: result.reuseDetected.userId,
          details: { reason: "refresh_token_reuse", session: result.reuseDetected.sessionId },
        });
      }
      return reply.header("Set-Cookie", clearedRefreshCookie()).code(401).send({ error: "Your session has ended" });
    }
    const { user, sessionId, refreshToken } = result;
    reply.header("Set-Cookie", refreshCookie(refreshToken));
    return {
      token: fastify.signAccessToken(user, sessionId),
      user: { user_id: user.user_id, name: user.name, role: user.role },
    };
  });

  fastify.post("/auth/logout", async (request, reply) => {
    const session = sessionForRefreshToken(readCookie(request.headers.cookie, REFRESH_COOKIE));
    if (session && authSessionsRepo.revoke(session.id, "logout", Date.now())) {
      auditLogsRepo.record({ user_id: session.user_id, action: "logout", entity_type: "user", entity_id: session.user_id, details: { session: session.id } });
    }
    return reply.header("Set-Cookie", clearedRefreshCookie()).send({ ok: true });
  });

  fastify.get(
    "/auth/me",
    { preHandler: fastify.authenticate },
    async (request) => request.user,
  );
}
