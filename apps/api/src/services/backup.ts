import fs from "node:fs";
import path from "node:path";
import { db, closeDb, openDb } from "../db/client.js";
import { config } from "../config.js";
import { settingsRepo } from "../repositories/settings.js";

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

/** Resolves a backup filename to its on-disk path for the download route — validates the
 *  filename the same way restoreBackup() does, since this also turns user input into a path. */
export function getBackupPath(filename: string): string {
  assertSafeFilename(filename);
  const filePath = path.join(backupsDir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Backup not found: ${filename}`);
  return filePath;
}

/** Deletes the oldest backups beyond `keep`, newest-first per listBackups()'s sort — keeps the
 *  backups directory from growing unbounded under scheduled automatic backups. */
export function pruneOldBackups(keep: number): void {
  const stale = listBackups().slice(keep);
  for (const backup of stale) {
    fs.rmSync(path.join(backupsDir, backup.filename), { force: true });
  }
}

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_BACKUP_RETENTION = 14;

/** Runs a backup now if the newest one on disk is more than a day old (or none exists) and the
 *  AUTOBACKUP setting allows it — covers both "it's been a day" and "the server was just
 *  restarted after being off for a while", so a live station is never more than ~a day stale. */
function runAutoBackupIfDue(): void {
  if (settingsRepo.getAll().AUTOBACKUP !== "YES") return;
  const [latest] = listBackups();
  const isStale = !latest || Date.now() - new Date(latest.createdAt).getTime() >= AUTO_BACKUP_INTERVAL_MS;
  if (!isStale) return;
  createBackup();
  pruneOldBackups(AUTO_BACKUP_RETENTION);
}

/** Checks immediately on startup, then once a day thereafter — called once from index.ts when the
 *  server actually starts listening (not from buildApp(), so building the app for tests never
 *  schedules background work). */
export function startBackupScheduler(): void {
  runAutoBackupIfDue();
  setInterval(runAutoBackupIfDue, AUTO_BACKUP_INTERVAL_MS);
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
