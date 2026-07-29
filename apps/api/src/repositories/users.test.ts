import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { usersRepo } = await import("./users.js");

test("create() defaults active to 1 and omits the password hash from the returned user", () => {
  const created = usersRepo.create({ user_id: "U1", name: "Test User", password_hash: "hash", role: "operator" });
  assert.equal(created.active, 1);
  assert.equal((created as Record<string, unknown>).password_hash, undefined);
});

test("update() changes name/role without touching the password", () => {
  usersRepo.create({ user_id: "U2", name: "Original", password_hash: "hash", role: "operator" });
  const updated = usersRepo.update("U2", { name: "Renamed", role: "owner" });
  assert.equal(updated?.name, "Renamed");
  assert.equal(updated?.role, "owner");
  assert.equal(usersRepo.getById("U2")?.password_hash, "hash");
});

test("setActive() toggles active and setPasswordHash() changes the hash", () => {
  usersRepo.create({ user_id: "U3", name: "Toggle Me", password_hash: "old-hash", role: "field_operator" });
  usersRepo.setActive("U3", false);
  assert.equal(usersRepo.getById("U3")?.active, 0);
  usersRepo.setActive("U3", true);
  assert.equal(usersRepo.getById("U3")?.active, 1);

  usersRepo.setPasswordHash("U3", "new-hash");
  assert.equal(usersRepo.getById("U3")?.password_hash, "new-hash");
});

test("list() never includes password_hash", () => {
  usersRepo.create({ user_id: "U4", name: "Listed", password_hash: "secret", role: "super_admin" });
  const all = usersRepo.list();
  for (const user of all) {
    assert.equal((user as Record<string, unknown>).password_hash, undefined);
  }
});

test("getByEmail() finds a user by their Google SSO email, used by routes/googleAuth.ts", () => {
  usersRepo.create({ user_id: "U5", name: "Has Email", password_hash: "hash", role: "operator", email: "u5@example.com" });
  assert.equal(usersRepo.getByEmail("u5@example.com")?.user_id, "U5");
  assert.equal(usersRepo.getByEmail("nobody@example.com"), undefined);
});

test("update() without an email field leaves a previously-set email untouched", () => {
  usersRepo.create({ user_id: "U6", name: "Keep Email", password_hash: "hash", role: "operator", email: "u6@example.com" });
  usersRepo.update("U6", { name: "Renamed U6", role: "operator" });
  assert.equal(usersRepo.getById("U6")?.email, "u6@example.com");
});

test("update() with an explicit email clears or changes it", () => {
  usersRepo.create({ user_id: "U7", name: "Change Email", password_hash: "hash", role: "operator", email: "old@example.com" });
  usersRepo.update("U7", { name: "Change Email", role: "operator", email: "new@example.com" });
  assert.equal(usersRepo.getById("U7")?.email, "new@example.com");
  usersRepo.update("U7", { name: "Change Email", role: "operator", email: null });
  assert.equal(usersRepo.getById("U7")?.email, null);
});
