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

test("moneyWords: every digit-length branch takes only the digits after its head (MONEY.PRG substr)", () => {
  assert.equal(moneyWords(5005), "Five Thousand Five");
  assert.equal(moneyWords(12345), "Twelve Thousand Three hundred Fourty Five");
  assert.equal(moneyWords(34089), "Thirty Four Thousand Eighty Nine");
  assert.equal(moneyWords(34000), "Thirty Four Thousand");
  assert.equal(moneyWords(134089), "One Lakh Thirty Four Thousand Eighty Nine");
  assert.equal(moneyWords(1234567), "Twelve Lakh Thirty Four Thousand Five hundred Sixty Seven");
  assert.equal(moneyWords(1200000), "Twelve Lakh");
  assert.equal(moneyWords(12345678), "One Crore Twenty Three Lakh Fourty Five Thousand Six hundred Seventy Eight");
  assert.equal(
    moneyWords(123456789),
    "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven hundred Eighty Nine",
  );
});

test("amountInWords: five-digit invoice total", () => {
  assert.equal(amountInWords(25750.5), "Rupees Twenty Five Thousand Seven hundred Fifty and Fifty Paise Only");
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
