import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { applySchema } from "./schema.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

// `let`, not `const` — restoreBackup() (services/backup.ts) needs to swap the live connection
// after replacing the underlying file. ESM exports are live bindings, so every module that did
// `import { db }` sees the reassignment automatically.
export let db = new DatabaseSync(config.dbPath);
applySchema(db);

export function closeDb(): void {
  db.close();
}

export function openDb(): void {
  db = new DatabaseSync(config.dbPath);
  applySchema(db);
}
