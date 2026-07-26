import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Unlike the other test files, this one needs a real file on disk (not ":memory:") — VACUUM INTO
// writes to a real path, and restoreBackup() needs a real file to close, overwrite, and reopen.
const testDbPath = path.join(os.tmpdir(), `petropro-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = testDbPath;

// NOTE: `dbClient.db` (property access) is used below instead of destructuring `{ db }` out of
// this dynamic import. Destructuring copies the binding's *value* at that instant into a new,
// independent `const` — it does not track db/client.ts's later `db = new DatabaseSync(...)`
// reassignment inside openDb(). Only a real static `import { db } from "..."` (what every
// repository uses) or repeated `dbClient.db` property access preserves the ESM live binding.
const dbClient = await import("../db/client.js");
const { groupsRepo } = await import("../repositories/groups.js");
const { createBackup, listBackups, restoreBackup } = await import("./backup.js");

test.after(() => {
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // best-effort cleanup
  }
  try {
    fs.rmSync(path.join(path.dirname(testDbPath), "backups"), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

test("createBackup + restoreBackup round-trips data and the live connection keeps working", () => {
  // This is the regression this whole file guards: db/client.ts changed from `export const db`
  // to `export let db` specifically so restoreBackup() can close and reopen the connection after
  // overwriting the file, and every module that already did `import { db }` (every repository)
  // needed to see that reassignment automatically via ESM live bindings. A passing build/typecheck
  // does not prove this actually works at runtime — only exercising it does.
  groupsRepo.create({ code: "X", name: "Before backup" });
  const backup = createBackup();
  assert.ok(backup.filename.endsWith(".db"));

  groupsRepo.create({ code: "Y", name: "After backup" });
  assert.ok(groupsRepo.get("Y"), "sanity check: Y exists before restore");

  restoreBackup(backup.filename);

  // Y was created after the snapshot, so restoring should make it disappear; X should remain.
  assert.ok(groupsRepo.get("X"));
  assert.equal(groupsRepo.get("Y"), undefined);

  // The live `db` binding — and every repository holding a reference to it — must still work
  // after the underlying connection was closed and reopened against the restored file.
  assert.doesNotThrow(() => dbClient.db.prepare("SELECT 1").get());
  assert.doesNotThrow(() => groupsRepo.create({ code: "Z", name: "After restore" }));
});

test("listBackups reflects created backups", () => {
  const before = listBackups().length;
  createBackup();
  assert.equal(listBackups().length, before + 1);
});

test("restoreBackup rejects a path-traversal filename", () => {
  assert.throws(() => restoreBackup("../../etc/passwd"), /invalid/i);
  assert.throws(() => restoreBackup("sub/dir.db"), /invalid/i);
});

test("restoreBackup rejects a nonexistent backup", () => {
  assert.throws(() => restoreBackup("does-not-exist.db"), /not found/i);
});
