import test from "node:test";
import assert from "node:assert/strict";
import { auditUserEmails, type EmailAuditUser } from "./userEmailAudit.js";

const user = (user_id: string, name: string, email: string | null, active = 1): EmailAuditUser => ({ user_id, name, role: "operator", active, email });
const kinds = (users: EmailAuditUser[], customers: string[] = []) => auditUserEmails(users, customers).map((f) => `${f.user_id}:${f.severity}:${f.kind}`);

test("a clean record has no findings", () => {
  assert.deepEqual(kinds([user("ravi", "Ravi Kumar", "ravi.kumar@gmail.com")]), []);
});

test("duplicates, including ones differing only by case, block", () => {
  const found = kinds([user("a", "Asha", "asha@gmail.com"), user("b", "Asha B", "ASHA@gmail.com")]);
  assert.ok(found.includes("a:block:duplicate"));
  assert.ok(found.includes("b:block:duplicate"));
  assert.ok(found.includes("b:block:not_normalized"));
});

test("invalid and placeholder addresses block", () => {
  for (const bad of ["not-an-email", "two@@signs.com", "spaces in@gmail.com", "nodomain@", "@gmail.com", "x@nodot"]) {
    assert.ok(kinds([user("u", "U Ser", bad)]).includes("u:block:invalid_format"), bad);
  }
  assert.ok(kinds([user("sam", "Sam", "sam@example.com")]).includes("sam:block:placeholder_domain"));
});

test("possible mismatches are flagged for a person to judge", () => {
  assert.deepEqual(kinds([user("cash1", "Ravi Kumar", "priya77@gmail.com")]), ["cash1:review:name_mismatch"]);
  assert.deepEqual(kinds([user("ravi", "Ravi Kumar", "info@station.com")]), ["ravi:review:shared_mailbox"]);
  assert.deepEqual(kinds([user("ravi", "Ravi Kumar", "ravi@gmail.com")], ["RAVI@gmail.com"]), ["ravi:review:shared_with_customer"]);
});

test("no email and deactivated users are only noted", () => {
  assert.deepEqual(kinds([user("a", "Asha", null)]), ["a:info:no_email"]);
  assert.deepEqual(kinds([user("a", "Asha", null, 0)]), []);
  assert.deepEqual(kinds([user("asha", "Asha", "asha@gmail.com", 0)]), ["asha:info:inactive_with_email"]);
});
