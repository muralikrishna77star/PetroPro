import type { FastifyInstance } from "fastify";
import { vehiclesRepo, vehicleKey } from "../repositories/vehicles.js";
import { customersRepo } from "../repositories/customers.js";
import { auditLogsRepo } from "../repositories/auditLogs.js";

/** The vehicle master (Maintenance → Vehicles), and the lookup Billing's vehicle box uses. */
export default async function vehicleRoutes(fastify: FastifyInstance) {
  fastify.get("/vehicles", { preHandler: fastify.authenticate }, async () => vehiclesRepo.list());

  // Numbers that look like the same vehicle keyed in different ways — the merge tool's list.
  // Registered before /vehicles/:vehicleNo, though find-my-way matches static paths first anyway.
  fastify.get(
    "/vehicles/near-matches",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async () => vehiclesRepo.nearMatches(),
  );

  fastify.get<{ Params: { vehicleNo: string } }>(
    "/vehicles/:vehicleNo",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const vehicle = vehiclesRepo.resolve(request.params.vehicleNo);
      if (!vehicle) return reply.code(404).send({ error: "Vehicle not found" });
      return vehicle;
    },
  );

  fastify.post<{ Body: { vehicle_no?: string; customer_code?: string | null } }>(
    "/vehicles",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async (request, reply) => {
      const vehicleNo = vehicleKey(request.body?.vehicle_no ?? "");
      const customerCode = request.body?.customer_code || null;
      if (vehicleNo.length < 2) return reply.code(400).send({ error: "Enter a vehicle number" });
      if (customerCode && !customersRepo.get(customerCode)) {
        return reply.code(400).send({ error: `Unknown customer code: ${customerCode}` });
      }
      const existing = vehiclesRepo.resolve(vehicleNo);
      if (existing) return reply.code(409).send({ error: `${existing.vehicle_no} is already on file` });
      const vehicle = vehiclesRepo.create({ vehicle_no: vehicleNo, customer_code: customerCode, fleet_card: null });
      auditLogsRepo.record({ user_id: request.user.sub, action: "create_vehicle", entity_type: "vehicle", details: vehicle });
      return reply.code(201).send(vehicle);
    },
  );

  // Changing which customer a vehicle belongs to (or clearing it). The number itself is corrected
  // by merging it into the right one, which also moves its bills.
  fastify.put<{ Params: { vehicleNo: string }; Body: { customer_code?: string | null } }>(
    "/vehicles/:vehicleNo",
    { preHandler: fastify.requireRole("super_admin", "owner", "operator") },
    async (request, reply) => {
      const vehicle = vehiclesRepo.get(request.params.vehicleNo);
      if (!vehicle) return reply.code(404).send({ error: "Vehicle not found" });
      const customerCode = request.body?.customer_code || null;
      if (customerCode && !customersRepo.get(customerCode)) {
        return reply.code(400).send({ error: `Unknown customer code: ${customerCode}` });
      }
      const updated = vehiclesRepo.setOwner(vehicle.vehicle_no, customerCode);
      auditLogsRepo.record({
        user_id: request.user.sub,
        action: "update_vehicle_owner",
        entity_type: "vehicle",
        details: { vehicle_no: vehicle.vehicle_no, from: vehicle.customer_code, to: customerCode },
      });
      return updated;
    },
  );

  // Corrects wrongly keyed numbers: everything billed against the merged numbers moves to `keep`.
  fastify.post<{ Body: { keep?: string; merge?: string[] } }>(
    "/vehicles/merge",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const { keep, merge } = request.body ?? {};
      if (!keep || !merge?.length) return reply.code(400).send({ error: "keep and merge are required" });
      try {
        const result = vehiclesRepo.merge(keep, merge);
        auditLogsRepo.record({ user_id: request.user.sub, action: "merge_vehicles", entity_type: "vehicle", details: result });
        return result;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // "Not the same vehicle": stop suggesting these numbers as near matches.
  fastify.post<{ Body: { vehicle_nos?: string[] } }>(
    "/vehicles/distinct",
    { preHandler: fastify.requireRole("super_admin", "owner") },
    async (request, reply) => {
      const vehicleNos = request.body?.vehicle_nos ?? [];
      if (vehicleNos.length < 2) return reply.code(400).send({ error: "Give at least two vehicle numbers" });
      vehiclesRepo.markDistinct(vehicleNos);
      auditLogsRepo.record({ user_id: request.user.sub, action: "mark_vehicles_distinct", entity_type: "vehicle", details: { vehicleNos } });
      return { ok: true };
    },
  );
}
