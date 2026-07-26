import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { usersRepo, type Role } from "../repositories/users.js";
import { hashPassword } from "../services/auth.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

const ROLES: Role[] = ["super_admin", "owner", "operator", "field_operator"];

function generateTempPassword(): string {
  return crypto.randomBytes(6).toString("hex");
}

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/users", { preHandler: fastify.requireRole("super_admin") }, async () => usersRepo.list());

  fastify.post<{ Body: { user_id: string; name: string; role: Role; password?: string } }>(
    "/users",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      const { user_id, name, role, password } = request.body ?? {};
      if (!user_id || !name || !role) {
        return reply.code(400).send({ error: "user_id, name and role are required" });
      }
      if (!ROLES.includes(role)) {
        return reply.code(400).send({ error: `role must be one of: ${ROLES.join(", ")}` });
      }
      if (usersRepo.getById(user_id)) {
        return reply.code(409).send({ error: `User ${user_id} already exists` });
      }

      const tempPassword = password || generateTempPassword();
      const created = usersRepo.create({
        user_id,
        name,
        password_hash: hashPassword(tempPassword),
        role,
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

  fastify.put<{ Params: { id: string }; Body: { name: string; role: Role } }>(
    "/users/:id",
    { preHandler: fastify.requireRole("super_admin") },
    async (request, reply) => {
      const { name, role } = request.body ?? {};
      if (!name || !role) return reply.code(400).send({ error: "name and role are required" });
      if (!ROLES.includes(role)) {
        return reply.code(400).send({ error: `role must be one of: ${ROLES.join(", ")}` });
      }
      const updated = usersRepo.update(request.params.id, { name, role });
      if (!updated) return reply.code(404).send({ error: "User not found" });
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
      return { user_id: request.params.id, temporaryPassword: tempPassword };
    },
  );
}
