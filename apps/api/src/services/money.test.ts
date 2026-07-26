import test from "node:test";
import assert from "node:assert/strict";
import { moneyWords, amountInWords } from "./money.js";

test("moneyWords: ones and teens", () => {
  assert.equal(moneyWords(1), "One");
  assert.equal(moneyWords(9), "Nine");
  assert.equal(moneyWords(10), "Ten");
  assert.equal(moneyWords(19), "Nineteen");
});

test("moneyWords: tens, preserving the legacy 'Fourty' spelling from MONEY.PRG", () => {
  assert.equal(moneyWords(20), "Twenty");
  assert.equal(moneyWords(40), "Fourty");
  assert.equal(moneyWords(66), "Sixty Six");
});

test("moneyWords: hundreds (legacy lowercase 'hundred')", () => {
  assert.equal(moneyWords(100), "One hundred");
  assert.equal(moneyWords(366), "Three hundred Sixty Six");
});

test("moneyWords: thousands, lakhs, crores", () => {
  assert.equal(moneyWords(1366), "One Thousand Three hundred Sixty Six");
  assert.equal(moneyWords(100000), "One Lakh");
  assert.equal(moneyWords(150000), "One Lakh Fifty Thousand");
  assert.equal(moneyWords(10000000), "One Crore");
});

test("moneyWords: rejects values outside the legacy-supported range", () => {
  assert.throws(() => moneyWords(1000000001));
});

test("amountInWords: whole rupees, no paise", () => {
  assert.equal(amountInWords(798), "Rupees Seven hundred Ninety Eight Only");
});

test("amountInWords: with paise", () => {
  assert.equal(amountInWords(1366.2), "Rupees One Thousand Three hundred Sixty Six and Twenty Paise Only");
});

test("amountInWords: zero rupees", () => {
  assert.equal(amountInWords(0), "Rupees Zero Only");
});
