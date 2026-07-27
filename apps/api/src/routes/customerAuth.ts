import type { FastifyInstance } from "fastify";
import { customersRepo } from "../repositories/customers.js";
import { verifyPassword } from "../services/auth.js";

/** A customer's own login, separate from staff auth (see plugins/auth.ts's `authenticateCustomer`
 *  and `CustomerTokenPayload`) — email + password against the `customers` table, provisioned by
 *  staff via POST /customers/:code/set-password (routes/customers.ts), not self-signup. */
export default async function customerAuthRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { email: string; password: string } }>("/customer/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required" });
    }

    const customer = customersRepo.getByEmail(email);
    if (!customer || !customer.password_hash || !verifyPassword(password, customer.password_hash)) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = fastify.jwt.sign({ sub: customer.code, role: "customer", name: customer.name });
    return { token, customer: { code: customer.code, name: customer.name } };
  });

  fastify.get(
    "/customer/me",
    { preHandler: fastify.authenticateCustomer },
    async (request, reply) => {
      const customer = customersRepo.get(request.user.sub);
      if (!customer) return reply.code(404).send({ error: "Customer not found" });
      return customer;
    },
  );
}
