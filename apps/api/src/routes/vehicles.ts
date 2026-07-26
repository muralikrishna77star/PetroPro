import type { FastifyInstance } from "fastify";
import { vehiclesRepo, type Vehicle } from "../repositories/vehicles.js";

export default async function vehicleRoutes(fastify: FastifyInstance) {
  fastify.get("/vehicles", { preHandler: fastify.authenticate }, async () => vehiclesRepo.list());

  fastify.get<{ Params: { vehicleNo: string } }>(
    "/vehicles/:vehicleNo",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const vehicle = vehiclesRepo.get(request.params.vehicleNo);
      if (!vehicle) return reply.code(404).send({ error: "Vehicle not found" });
      return vehicle;
    },
  );

  fastify.post<{ Body: Vehicle }>(
    "/vehicles",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => reply.code(201).send(vehiclesRepo.create(request.body)),
  );
}
