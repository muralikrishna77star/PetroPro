import test from "node:test";
import assert from "node:assert/strict";
import { isValidHsnCode } from "./hsn.js";

test("isValidHsnCode accepts 4, 6, and 8 digit numeric codes", () => {
  assert.equal(isValidHsnCode("2710"), true);
  assert.equal(isValidHsnCode("271019"), true);
  assert.equal(isValidHsnCode("27101990"), true);
});

test("isValidHsnCode treats absent codes as valid (field is optional)", () => {
  assert.equal(isValidHsnCode(undefined), true);
  assert.equal(isValidHsnCode(null), true);
  assert.equal(isValidHsnCode(""), true);
});

test("isValidHsnCode rejects wrong lengths, non-numeric, and formatted input", () => {
  assert.equal(isValidHsnCode("123"), false);
  assert.equal(isValidHsnCode("12345"), false);
  assert.equal(isValidHsnCode("123456789"), false);
  assert.equal(isValidHsnCode("27AB"), false);
  assert.equal(isValidHsnCode("2710.19"), false);
  assert.equal(isValidHsnCode(" 2710"), false);
});
