import test from "node:test";
import assert from "node:assert/strict";

// db/client.ts reads DB_PATH at module-load time, so this must be set before anything that
// transitively imports it is loaded — hence the dynamic import below instead of a static one.
// node --test runs each test file in its own process (verified), so ":memory:" here doesn't
// leak into other test files.
process.env.DB_PATH = ":memory:";
const { customersRepo } = await import("./customers.js");

test("create() does not throw when optional fields (credit_limit, service_charge) are omitted", () => {
  // Regression: node:sqlite's .run() throws ERR_INVALID_ARG_TYPE on a bound `undefined` rather
  // than treating it as null. This crashed with a 500 in production the first time a caller
  // (the web Customers page's minimal "add customer" form) omitted these fields — see
  // AI_Handoff.md Session 5.
  const created = customersRepo.create({ code: "C001", name: "Test Customer" } as never);
  assert.equal(created.code, "C001");
  assert.equal(created.credit_limit, 0);
  assert.equal(created.service_charge, 0);
  assert.equal(created.due_amount, 0);
});

test("update() does not throw when optional fields are omitted", () => {
  customersRepo.create({ code: "C002", name: "Another Customer" } as never);
  const updated = customersRepo.update("C002", { name: "Renamed" } as never);
  assert.equal(updated?.name, "Renamed");
  assert.equal(updated?.credit_limit, 0);
});

test("adjustDueAmount / setDueAmount", () => {
  customersRepo.create({ code: "C003", name: "Due Amount Test" } as never);
  customersRepo.adjustDueAmount("C003", 500);
  assert.equal(customersRepo.get("C003")?.due_amount, 500);
  customersRepo.setDueAmount("C003", 100);
  assert.equal(customersRepo.get("C003")?.due_amount, 100);
});
