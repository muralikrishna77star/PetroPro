import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { settingsRepo } = await import("./settings.js");

test("getAll() returns the legacy defaults when nothing has been changed", () => {
  const all = settingsRepo.getAll();
  assert.equal(all.KEROSENE, "NO");
  assert.equal(all.PRINTTESTMODE, "YES");
});

test("setMany() updates only the given keys and persists across calls", () => {
  settingsRepo.setMany({ KEROSENE: "YES", FLEETCARDENTRY: "YES" });
  const all = settingsRepo.getAll();
  assert.equal(all.KEROSENE, "YES");
  assert.equal(all.FLEETCARDENTRY, "YES");
  assert.equal(all.PRINTTESTMODE, "YES");
});
