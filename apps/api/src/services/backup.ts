import fs from "node:fs";
import path from "node:path";
import { db, closeDb, openDb } from "../db/client.js";
import { config } from "../config.js";

const backupsDir = path.join(path.dirname(config.dbPath), "backups");

export interface BackupFile {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

function assertSafeFilename(filename: string): void {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("Invalid backup filename");
  }
}

/** Live snapshot via SQLite's `VACUUM INTO` — safe to run against an open database (unlike a
 *  raw file copy, which can capture a torn write mid-transaction). node:sqlite's DatabaseSync
 *  has no dedicated backup API, so this is the standard SQLite-native alternative. */
export function createBackup(): BackupFile {
  fs.mkdirSync(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `petropro-${timestamp}.db`;
  const dest = path.join(backupsDir, filename);

  db.exec(`VACUUM INTO '${dest.replace(/\\/g, "/")}'`);

  const stat = fs.statSync(dest);
  return { filename, sizeBytes: stat.size, createdAt: stat.birthtime.toISOString() };
}

export function listBackups(): BackupFile[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith(".db"))
    .map((filename) => {
      const stat = fs.statSync(path.join(backupsDir, filename));
      return { filename, sizeBytes: stat.size, createdAt: stat.birthtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Overwrites the live database file with a prior backup and reopens the connection. Destructive
 *  and irreversible for any data written since the backup — callers must confirm with the user
 *  before invoking this (see the `confirm` flag required by the /backup/restore route). */
export function restoreBackup(filename: string): void {
  assertSafeFilename(filename);
  const src = path.join(backupsDir, filename);
  if (!fs.existsSync(src)) throw new Error(`Backup not found: ${filename}`);

  closeDb();
  fs.copyFileSync(src, config.dbPath);
  openDb();
}
