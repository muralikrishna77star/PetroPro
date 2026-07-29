import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startBackupScheduler } from "./services/backup.js";

const app = await buildApp();

try {
  await app.listen({ port: config.port, host: config.host });
  startBackupScheduler();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
