import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { customersRepo } from "../repositories/customers.js";
import { getCustomerLedger } from "../services/ledger.js";

/** Identity always comes from the verified customer token, never a supplied customer code. */
export default async function customerReportRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { from: string; to: string } }>(
    "/customer/reports",
    { preHandler: app.authenticateCustomer },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const { from, to } = request.query;
      const validDate = (value: unknown): value is string =>
        typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
      if (!validDate(from) || !validDate(to) || from > to) {
        return reply.code(400).send({ error: "Choose valid From and To dates in chronological order" });
      }
      const customer = customersRepo.get(request.user.sub);
      if (!customer) return reply.code(401).send({ error: "Customer account is unavailable" });
      const purchases = db.prepare(`
        SELECT bill_no, bill_date, vehicle_no, payment_type, grand_total
        FROM bills WHERE customer_code = ? AND status != 'cancelled'
        AND date(bill_date) BETWEEN ? AND ? ORDER BY bill_date, bill_no
      `).all(customer.code, from, to);
      const ledger = getCustomerLedger(customer.code, from, to);
      return {
        customer: { code: customer.code, name: customer.name }, from, to,
        report_style: customer.report_style,
        credit_limit: customer.credit_limit,
        opening_balance: ledger[0]?.balance ?? 0,
        closing_balance: ledger.at(-1)?.balance ?? 0,
        ledger, purchases,
      };
    },
  );
}
