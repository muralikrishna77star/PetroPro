import type { FastifyInstance } from "fastify";
import { pumpsRepo } from "../repositories/pumps.js";

export default async function pumpRoutes(fastify: FastifyInstance) {
  fastify.get("/pumps", { preHandler: fastify.authenticate }, async () => pumpsRepo.list());

  fastify.post<{ Body: { code: string; name: string } }>(
    "/pumps",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { code, name } = request.body ?? {};
      if (!code || !name) return reply.code(400).send({ error: "code and name are required" });
      if (pumpsRepo.get(code)) return reply.code(409).send({ error: `Pump ${code} already exists` });
      return reply.code(201).send(pumpsRepo.create({ code, name }));
    },
  );

  fastify.put<{ Params: { code: string }; Body: { name: string } }>(
    "/pumps/:code",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { name } = request.body ?? {};
      if (!name) return reply.code(400).send({ error: "name is required" });
      const updated = pumpsRepo.update(request.params.code, name);
      if (!updated) return reply.code(404).send({ error: "Pump not found" });
      return updated;
    },
  );
}
