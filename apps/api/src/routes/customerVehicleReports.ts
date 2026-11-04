import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { customersRepo } from "../repositories/customers.js";
import { getCustomerStatement } from "../services/customerStatement.js";
import { generateCustomerStatementPdf } from "../services/customerStatementPdf.js";

interface Query { from?: string; to?: string; vehicle_no?: string; group_by_vehicle?: string; with_opening?: string; }
function options(code: string, query: Query) {
  const valid = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!valid(query.from) || !valid(query.to) || query.from > query.to) throw new Error("Choose valid From and To dates in chronological order");
  if (query.vehicle_no !== undefined && (typeof query.vehicle_no !== "string" || query.vehicle_no.length > 100)) throw new Error("Enter a valid vehicle number");
  return { customerCode: code, from: query.from, to: query.to, vehicleNo: query.vehicle_no?.trim() || undefined,
    groupByVehicle: query.group_by_vehicle === "1", withOpening: query.with_opening === "1" };
}

function mileageRows(opts: ReturnType<typeof options>, creditOnly = false) {
  return db.prepare(`SELECT m.*, date(b.bill_date) AS bill_date, COALESCE(i.name, m.item_code) AS item_name
    FROM mileage_log m JOIN bills b ON b.bill_no = m.bill_no LEFT JOIN items i ON i.code = m.item_code
    WHERE b.customer_code = ? AND b.status != 'cancelled' AND date(b.bill_date) BETWEEN ? AND ?
    AND (? = 0 OR b.payment_type = 'credit')
    AND (? = '' OR upper(m.vehicle_no) = upper(?)) ORDER BY m.vehicle_no, b.bill_date, m.id`)
    .all(opts.customerCode, opts.from, opts.to, creditOnly ? 1 : 0, opts.vehicleNo ?? "", opts.vehicleNo ?? "");
}

/** Never accept a customer code from the browser, including for PDF and vehicle lookups. */
export default async function customerVehicleReports(app: FastifyInstance) {
  for (const pdf of [false, true]) {
    app.get<{ Querystring: Query }>(pdf ? "/customer/reports/statement.pdf" : "/customer/reports/statement",
      { preHandler: app.authenticateCustomer }, async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!customersRepo.get(request.user.sub)) return reply.code(401).send({ error: "Customer account is unavailable" });
        let opts;
        try { opts = options(request.user.sub, request.query); }
        catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
        const statement = getCustomerStatement(opts);
        if (!pdf) return statement;
        return reply.header("Content-Type", "application/pdf")
          .header("Content-Disposition", 'attachment; filename="my-credit-statement.pdf"')
          .send(await generateCustomerStatementPdf(statement));
      });
  }
  app.get<{ Querystring: Query }>("/customer/reports/mileage", { preHandler: app.authenticateCustomer }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!customersRepo.get(request.user.sub)) return reply.code(401).send({ error: "Customer account is unavailable" });
    let opts;
    try { opts = options(request.user.sub, request.query); }
    catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
    const rows = mileageRows(opts);
    return { from: opts.from, to: opts.to, vehicle_no: opts.vehicleNo ?? null, rows };
  });
  app.get<{ Params: { code: string }; Querystring: Query }>("/reports/customers/:code/mileage", { preHandler: app.requireRole("super_admin", "owner") }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const customer = customersRepo.get(request.params.code);
    if (!customer) return reply.code(404).send({ error: "Customer not found" });
    let opts;
    try { opts = options(customer.code, request.query); }
    catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
    return { from: opts.from, to: opts.to, vehicle_no: opts.vehicleNo ?? null, rows: mileageRows(opts, true) };
  });

}
