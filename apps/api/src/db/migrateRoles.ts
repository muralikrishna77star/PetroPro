import { db } from "./client.js";

/**
 * One-time migration: the `users.role` CHECK constraint changed from
 * ('admin','manager','cashier','attendant') to ('super_admin','owner','operator','field_operator')
 * as part of the portal rebrand (permissions unchanged, values renamed only). SQLite can't ALTER
 * a CHECK constraint in place, so this rebuilds the table. Safe to re-run: skips if no row still
 * has an old-style role value.
 */
function migrateRoles(): void {
  const stale = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role IN ('admin','manager','cashier','attendant')")
    .get() as { n: number };

  if (stale.n === 0) {
    console.log("No legacy role values found — nothing to migrate.");
    return;
  }

  console.log(`Migrating ${stale.n} user(s) to the new role values...`);

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN TRANSACTION");
  try {
    // Deliberately NOT "RENAME users TO users_old" — SQLite auto-rewrites every other table's
    // stored FK text (bills/pending_transactions/receipts/shifts/audit_logs all say
    // "REFERENCES users(...)") to point at whatever `users` gets renamed to, and dropping that
    // renamed-aside table afterwards leaves them all referencing a table that no longer exists
    // (found the hard way: silent until an actual INSERT enforces the dangling FK). Building the
    // replacement under a fresh name and dropping the ORIGINAL instead avoids ever renaming the
    // name other tables actually point at.
    db.exec(`
      CREATE TABLE users_new (
        user_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('super_admin', 'owner', 'operator', 'field_operator')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        active INTEGER NOT NULL DEFAULT 1
      )
    `);
    db.exec(`
      INSERT INTO users_new (user_id, name, password_hash, role, created_at, active)
      SELECT
        user_id,
        name,
        password_hash,
        CASE role
          WHEN 'admin' THEN 'super_admin'
          WHEN 'manager' THEN 'owner'
          WHEN 'cashier' THEN 'operator'
          WHEN 'attendant' THEN 'field_operator'
          ELSE role
        END,
        created_at,
        active
      FROM users
    `);
    db.exec("DROP TABLE users");
    db.exec("ALTER TABLE users_new RENAME TO users");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  console.log("Role migration complete.");
}

migrateRoles();
