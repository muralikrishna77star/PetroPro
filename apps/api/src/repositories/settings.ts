import { db } from "../db/client.js";

/** Legacy SETTINGS.DBF-style operational flags — the keys/values this repo manages are a subset
 *  of the original 9 (VERSION, WORKINGPATH and GSTNO don't apply to a web app / are already
 *  covered by tenants.gst_no). Values are stored as the legacy 'YES'/'NO' strings rather
 *  than 0/1 to keep a 1:1 mapping with the DBF source. */
export const SETTINGS_KEYS = [
  "KEROSENE",
  "FLEETCARDENTRY",
  "PRINTTESTMODE",
  "PRINTSPECIALCHARACTERS",
  "BILLENTRY",
  "GSTNAMEADD",
  "AUTOBACKUP",
  "OFFLINEMODE",
] as const;

export type SettingKey = (typeof SETTINGS_KEYS)[number];
export type Settings = Record<SettingKey, "YES" | "NO">;

export const settingsRepo = {
  getAll(): Settings {
    const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return Object.fromEntries(SETTINGS_KEYS.map((k) => [k, (byKey.get(k) ?? "NO") as "YES" | "NO"])) as Settings;
  },

  setMany(values: Partial<Settings>): Settings {
    const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const key of SETTINGS_KEYS) {
      const value = values[key];
      if (value !== undefined) stmt.run(key, value);
    }
    return settingsRepo.getAll();
  },
};
