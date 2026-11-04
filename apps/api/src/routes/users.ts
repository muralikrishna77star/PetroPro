import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { usersRepo, type Role } from "../repositories/users.js";
import { hashPassword } from "../services/auth.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";
import { authSessionsRepo } from "../repositories/authSessions.js";

const ROLES: Role[] = ["super_admin", "owner", "operator", "field_operator"];

/** Ends every login a user has, and records it. */
function revokeSessions(adminId: string, userId: string, reason: string): number {
  const count = authSessionsRepo.revokeAllForUser(userId, reason, Date.now());
  auditLogsRepo.record({
    user_id: adminId,
    action: "sessions_revoked",
    entity_type: "user",
    entity_id: userId,
    details: { reason, count },
  });
  return count;
}

function generateTempPassword(): string {
  return crypto.randomBytes(6).toString("hex");
}

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/users", { preHandler: fastify.requireRole("super_admin") }, async () => usersRepo.list());

  fastify.post<{ Body: { user_id: string; name: string; role: Role; password?: string; email?: string | null } }>(
    "/users",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      const { user_id, name, role, password, email } = request.body ?? {};
      if (!user_id || !name || !role) {
        return reply.code(400).send({ error: "user_id, name and role are required" });
      }
      if (!ROLES.includes(role)) {
        return reply.code(400).send({ error: `role must be one of: ${ROLES.join(", ")}` });
      }
      if (usersRepo.getById(user_id)) {
        return reply.code(409).send({ error: `User ${user_id} already exists` });
      }
      const normalizedEmail = email ? email.trim().toLowerCase() : null;
      if (normalizedEmail && usersRepo.getByEmail(normalizedEmail)) {
        return reply.code(409).send({ error: `Email ${normalizedEmail} is already in use` });
      }

      const tempPassword = password || generateTempPassword();
      const created = usersRepo.create({
        user_id,
        name,
        password_hash: hashPassword(tempPassword),
        role,
        email: normalizedEmail,
      });
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "create_user",
        entity_type: "user",
        entity_id: user_id,
        details: { role },
      });
      return reply.code(201).send({ ...created, temporaryPassword: password ? undefined : tempPassword });
    },
  );

  fastify.put<{ Params: { id: string }; Body: { name: string; role: Role; email?: string | null } }>(
    "/users/:id",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      const { name, role, email } = request.body ?? {};
      if (!name || !role) return reply.code(400).send({ error: "name and role are required" });
      if (!ROLES.includes(role)) {
        return reply.code(400).send({ error: `role must be one of: ${ROLES.join(", ")}` });
      }
      const normalizedEmail = email ? email.trim().toLowerCase() : null;
      if (normalizedEmail) {
        const owner = usersRepo.getByEmail(normalizedEmail);
        if (owner && owner.user_id !== request.params.id) {
          return reply.code(409).send({ error: `Email ${normalizedEmail} is already in use` });
        }
      }
      const wasLinked = Boolean(usersRepo.getById(request.params.id)?.google_sub);
      const updated = usersRepo.update(request.params.id, { name, role, email: normalizedEmail });
      if (!updated) return reply.code(404).send({ error: "User not found" });
      if (wasLinked && !updated.google_linked) {
        auditLogsRepo.record({
          user_id: request.user.sub,
          action: "unlink_google",
          entity_type: "user",
          entity_id: request.params.id,
          details: { reason: "email_changed" },
        });
      }
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "update_user",
        entity_type: "user",
        entity_id: request.params.id,
        details: { name, role },
      });
      return updated;
    },
  );

  // The authorized recovery route: lets the user link a Google account again (their next Google
  // sign-in asks for their password), e.g. after they replace a lost Google account.
  fastify.delete<{ Params: { id: string } }>(
    "/users/:id/google-link",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      if (!usersRepo.getById(request.params.id)) return reply.code(404).send({ error: "User not found" });
      if (!usersRepo.unlinkGoogle(request.params.id)) {
        return reply.code(404).send({ error: "No Google account is linked to this user" });
      }
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "unlink_google",
        entity_type: "user",
        entity_id: request.params.id,
        details: { reason: "admin" },
      });
      return { ok: true };
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/users/:id/deactivate",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      if (request.params.id === request.user.sub) {
        return reply.code(400).send({ error: "You cannot deactivate your own account" });
      }
      const updated = usersRepo.setActive(request.params.id, false);
      if (!updated) return reply.code(404).send({ error: "User not found" });
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "deactivate_user",
        entity_type: "user",
        entity_id: request.params.id,
      });
      revokeSessions(request.user.sub, request.params.id, "user_deactivated");
      return updated;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/users/:id/reactivate",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      const updated = usersRepo.setActive(request.params.id, true);
      if (!updated) return reply.code(404).send({ error: "User not found" });
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "reactivate_user",
        entity_type: "user",
        entity_id: request.params.id,
      });
      return updated;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/users/:id/reset-password",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      if (!usersRepo.getById(request.params.id)) {
        return reply.code(404).send({ error: "User not found" });
      }
      const tempPassword = generateTempPassword();
      usersRepo.setPasswordHash(request.params.id, hashPassword(tempPassword));
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "reset_password",
        entity_type: "user",
        entity_id: request.params.id,
      });
      revokeSessions(request.user.sub, request.params.id, "password_reset");
      return { user_id: request.params.id, temporaryPassword: tempPassword };
    },
  );
}
