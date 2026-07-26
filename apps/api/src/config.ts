import path from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "petropro-dev-secret-change-me",
  dbPath: process.env.DB_PATH ?? path.resolve(process.cwd(), "data", "petropro.db"),
};
