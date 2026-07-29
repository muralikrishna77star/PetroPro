import type { FastifyInstance } from "fastify";
import { reportsRepo, type Granularity } from "../repositories/reports.js";
import { stockRepo } from "../repositories/stock.js";
import { purchasesRepo } from "../repositories/purchases.js";
import { mileageRepo } from "../repositories/mileage.js";
import { getCustomerLedger } from "../services/ledger.js";
import { generateGstSummaryExcel } from "../services/gstExcel.js";

interface RangeQuery {
  from?: string;
  to?: string;
  granularity?: string;
}

const GRANULARITIES: Granularity[] = ["day", "week", "month", "quarter", "half-year", "year"];

function resolveRange(query: RangeQuery): { from: string; to: string; granularity: Granularity } {
  const today = new Date().toISOString().slice(0, 10);
  const granularity: Granularity = GRANULARITIES.includes(query.granularity as Granularity)
    ? (query.granularity as Granularity)
    : "day";
  return { from: query.from ?? "0000-01-01", to: query.to ?? today, granularity };
}

export default async function reportRoutes(fastify: FastifyInstance) {
  const managerOnly = fastify.requireRole("super_admin", "owner");

  fastify.get<{ Querystring: RangeQuery & { groupBy?: string } }>(
    "/reports/sales",
    { preHandler: managerOnly },
    async (request, reply) => {
      const { from, to, granularity } = resolveRange(request.query);
      switch (request.query.groupBy) {
        case "cashier":
          return reportsRepo.salesByCashier(from, to, granularity);
        case "group":
          return reportsRepo.salesByGroup(from, to, granularity);
        case "group-items":
          return reportsRepo.salesByGroupItems(from, to, granularity);
        case "hsn":
          return reportsRepo.salesByHsn(from, to, granularity);
        case "item":
        case undefined:
          return reportsRepo.salesByItem(from, to, granularity);
        default:
          return reply.code(400).send({ error: "groupBy must be item, cashier, group, group-items, or hsn" });
      }
    },
  );

  fastify.get<{ Querystring: RangeQuery & { status?: string } }>(
    "/reports/bills",
    { preHandler: managerOnly },
    async (request) => {
      const { from, to } = resolveRange(request.query);
      return reportsRepo.billRegister(from, to, request.query.status);
    },
  );

  fastify.get<{ Querystring: RangeQuery }>(
    "/reports/vehicles",
    { preHandler: managerOnly },
    async (request) => {
      const { from, to } = resolveRange(request.query);
      return reportsRepo.vehicleSales(from, to);
    },
  );

  fastify.get<{ Querystring: RangeQuery }>(
    "/reports/fleet-cards",
    { preHandler: managerOnly },
    async (request) => {
      const { from, to } = resolveRange(request.query);
      return reportsRepo.fleetCardSales(from, to);
    },
  );

  fastify.get<{ Querystring: RangeQuery }>("/reports/gst", { preHandler: managerOnly }, async (request) => {
    const { from, to, granularity } = resolveRange(request.query);
    return reportsRepo.gstSummary(from, to, granularity);
  });

  fastify.get<{ Querystring: RangeQuery }>(
    "/reports/gst.xlsx",
    { preHandler: managerOnly },
    async (request, reply) => {
      const { from, to, granularity } = resolveRange(request.query);
      const buffer = await generateGstSummaryExcel(from, to, granularity);
      return reply
        .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("Content-Disposition", `attachment; filename="gst-summary-${from}-to-${to}.xlsx"`)
        .send(buffer);
    },
  );

  fastify.get<{ Querystring: RangeQuery & { item_code?: string } }>(
    "/reports/stock",
    { preHandler: managerOnly },
    async (request) => {
      const { from, to } = resolveRange(request.query);
      return stockRepo.listRange(from, to, request.query.item_code);
    },
  );

  // Opening/purchases/consumption/closing per item, bucketed by period — distinct from the raw
  // per-day "Stock Day-book" above, which carries the running `balance` the dashboard depends on.
  fastify.get<{ Querystring: RangeQuery & { item_code?: string } }>(
    "/reports/stock-summary",
    { preHandler: managerOnly },
    async (request) => {
      const { from, to, granularity } = resolveRange(request.query);
      return reportsRepo.stockSummary(from, to, granularity, request.query.item_code);
    },
  );

  fastify.get<{ Querystring: RangeQuery & { item_code?: string } }>(
    "/reports/purchases",
    { preHandler: managerOnly },
    async (request) => {
      const { from, to } = resolveRange(request.query);
      return purchasesRepo.listRange(from, to, request.query.item_code);
    },
  );

  // Group-wise view of purchases — same "group subtotal + item rows beneath" shape as
  // /reports/sales?groupBy=group-items, kept as its own endpoint since /reports/purchases above
  // stays the flat/raw per-purchase list.
  fastify.get<{ Querystring: RangeQuery }>(
    "/reports/purchases-by-group",
    { preHandler: managerOnly },
    async (request) => {
      const { from, to, granularity } = resolveRange(request.query);
      return reportsRepo.purchasesByGroupItems(from, to, granularity);
    },
  );

  fastify.get<{ Params: { code: string }; Querystring: RangeQuery }>(
    "/reports/customers/:code/ledger",
    { preHandler: managerOnly },
    async (request) => getCustomerLedger(request.params.code, request.query.from, request.query.to),
  );

  fastify.get<{ Querystring: { vehicle_no: string } }>(
    "/reports/mileage",
    { preHandler: managerOnly },
    async (request, reply) => {
      if (!request.query.vehicle_no) {
        return reply.code(400).send({ error: "vehicle_no query param is required" });
      }
      return mileageRepo.listByVehicle(request.query.vehicle_no);
    },
  );
}
