import test from "node:test";
import assert from "node:assert/strict";
import { splitFromInclusive, splitFromPretax, lineTotal } from "./tax.js";

test("splitFromInclusive recovers the pretax amount and tax for a round GST rate", () => {
  const result = splitFromInclusive(118, 18);
  assert.equal(result.pretax, 100);
  assert.equal(result.taxAmount, 18);
  assert.equal(result.inclusive, 118);
});

test("splitFromInclusive handles 0% tax (fuel before GST, per legacy TAX_PER=0 items)", () => {
  const result = splitFromInclusive(67.52, 0);
  assert.equal(result.pretax, 67.52);
  assert.equal(result.taxAmount, 0);
});

test("splitFromPretax is the inverse of splitFromInclusive", () => {
  const fromPretax = splitFromPretax(100, 18);
  assert.equal(fromPretax.inclusive, 118);
  assert.equal(fromPretax.taxAmount, 18);
});

test("lineTotal computes amount and tax for a quantity x rate", () => {
  const line = lineTotal(10, 96.72, 18);
  assert.equal(line.amount, 967.2);
  assert.equal(line.taxPercent, 18);
  // Expected tax derived the same way lineTotal derives it (splitting the line amount, not
  // qty * unit tax) — this is checking lineTotal's composition of splitFromInclusive, not
  // re-deriving the GST math independently.
  assert.equal(line.taxAmount, splitFromInclusive(line.amount, 18).taxAmount);
  assert.ok(line.taxAmount > 0);
});

test("lineTotal with zero tax leaves the full amount as pretax", () => {
  const line = lineTotal(5, 20, 0);
  assert.equal(line.amount, 100);
  assert.equal(line.taxAmount, 0);
});
