import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import type { Role } from "../repositories/users.js";

export interface AuthTokenPayload {
  sub: string;
  role: Role;
  name: string;
}

/** A customer's own login — a separate audience from staff, not a 5th `Role` value, so it
 *  can never accidentally satisfy a staff `requireRole(...)` allow-list. `sub` is the
 *  customer's `code`. */
export interface CustomerTokenPayload {
  sub: string;
  role: "customer";
  name: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthTokenPayload | CustomerTokenPayload;
    user: AuthTokenPayload | CustomerTokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateCustomer: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  await fastify.register(jwt, { secret: config.jwtSecret });

  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  fastify.decorate("requireRole", (...roles: Role[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }
      if (request.user.role === "customer" || !roles.includes(request.user.role)) {
        reply.code(403).send({ error: "Forbidden" });
      }
    };
  });

  fastify.decorate("authenticateCustomer", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    if (request.user.role !== "customer") {
      reply.code(403).send({ error: "Forbidden" });
    }
  });
}

export default fp(authPlugin);
