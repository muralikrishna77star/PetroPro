/**
 * Faithful port of legacy/Workarea/MONEY.PRG (functions `money`, `onenum`, `twonum`, `mot`).
 * Indian numbering (thousand/lakh/crore) amount-in-words, including the legacy "Fourty"
 * spelling — kept as-is to match historical printed invoices byte-for-byte, not fixed here.
 */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const TEENS = [
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
  "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Fourty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function digits(n: number): string {
  return Math.trunc(n).toString();
}

/** Direct port of MONEY.PRG's `money()` — words for an integer 0 < n <= 1,000,000,000. */
export function moneyWords(innums: number): string {
  if (innums <= 0) return "";

  if (innums < 10) {
    return ONES[innums];
  }
  if (innums < 100) {
    if (innums < 20) return TEENS[innums - 10];
    const d = digits(innums);
    return `${TENS[Number(d[0])]} ${ONES[Number(d[1])]}`.trim();
  }
  if (innums < 1000) {
    const d = digits(innums);
    const rest = innums % 100;
    return rest !== 0
      ? `${ONES[Number(d[0])]} hundred ${moneyWords(rest)}`
      : `${ONES[Number(d[0])]} hundred`;
  }
  if (innums < 10000) {
    const d = digits(innums);
    const rest = innums % 1000;
    return rest !== 0
      ? `${ONES[Number(d[0])]} Thousand ${moneyWords(rest)}`
      : `${ONES[Number(d[0])]} Thousand`;
  }
  if (innums < 100000) {
    const d = digits(innums);
    const head = Number(d.slice(0, 2));
    const rest = innums % 10000;
    return rest !== 0
      ? `${moneyWords(head)} Thousand ${moneyWords(rest)}`
      : `${moneyWords(head)} Thousand`;
  }
  if (innums < 1000000) {
    const d = digits(innums);
    const rest = innums % 100000;
    return rest !== 0
      ? `${ONES[Number(d[0])]} Lakh ${moneyWords(rest)}`
      : `${ONES[Number(d[0])]} Lakh`;
  }
  if (innums < 10000000) {
    const d = digits(innums);
    const head = Number(d.slice(0, 2));
    const rest = innums % 1000000;
    return rest !== 0
      ? `${moneyWords(head)} Lakh ${moneyWords(rest)}`
      : `${moneyWords(head)} Lakh`;
  }
  if (innums < 100000000) {
    const d = digits(innums);
    const rest = innums % 10000000;
    return rest !== 0
      ? `${ONES[Number(d[0])]} Crore ${moneyWords(rest)}`
      : `${ONES[Number(d[0])]} Crore`;
  }
  if (innums < 1000000000) {
    const d = digits(innums);
    const head = Number(d.slice(0, 2));
    const rest = innums % 100000000;
    return rest !== 0
      ? `${moneyWords(head)} Crore ${moneyWords(rest)}`
      : `${moneyWords(head)} Crore`;
  }
  if (innums === 1000000000) {
    return "Hundred Crore";
  }
  throw new RangeError(`moneyWords: value out of legacy-supported range: ${innums}`);
}

/**
 * Invoice-ready "Rupees ... Only" wrapper around moneyWords. This wrapper phrasing is a
 * standard convention (not found verbatim in legacy PRG sources) — only the digit-grouping
 * core above is a direct port.
 */
export function amountInWords(amount: number): string {
  const rupees = Math.trunc(amount);
  const paise = Math.round((amount - rupees) * 100);

  const rupeeWords = rupees > 0 ? moneyWords(rupees) : "Zero";
  if (paise > 0) {
    return `Rupees ${rupeeWords} and ${moneyWords(paise)} Paise Only`;
  }
  return `Rupees ${rupeeWords} Only`;
}
