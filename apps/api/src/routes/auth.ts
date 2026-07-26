import type { FastifyInstance } from "fastify";
import { usersRepo } from "../repositories/users.js";
import { verifyPassword } from "../services/auth.js";

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { user_id: string; password: string } }>("/auth/login", async (request, reply) => {
    const { user_id, password } = request.body ?? {};
    if (!user_id || !password) {
      return reply.code(400).send({ error: "user_id and password are required" });
    }

    const user = usersRepo.getById(user_id);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    if (!user.active) {
      return reply.code(401).send({ error: "This account has been deactivated" });
    }

    const token = fastify.jwt.sign({ sub: user.user_id, role: user.role, name: user.name });
    return { token, user: { user_id: user.user_id, name: user.name, role: user.role } };
  });

  fastify.get(
    "/auth/me",
    { preHandler: fastify.authenticate },
    async (request) => request.user,
  );
}
