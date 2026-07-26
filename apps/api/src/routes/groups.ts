import type { FastifyInstance } from "fastify";
import { groupsRepo } from "../repositories/groups.js";

export default async function groupRoutes(fastify: FastifyInstance) {
  fastify.get("/groups", { preHandler: fastify.authenticate }, async () => groupsRepo.list());

  fastify.post<{ Body: { code: string; name: string } }>(
    "/groups",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { code, name } = request.body;
      if (!code || !name) return reply.code(400).send({ error: "code and name are required" });
      return reply.code(201).send(groupsRepo.create({ code, name }));
    },
  );

  fastify.put<{ Params: { code: string }; Body: { name: string } }>(
    "/groups/:code",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const updated = groupsRepo.update(request.params.code, request.body.name);
      if (!updated) return reply.code(404).send({ error: "Group not found" });
      return updated;
    },
  );
}
