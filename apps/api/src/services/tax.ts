/**
 * GST engine mirroring the legacy *BTX (before-tax) / *TAX (tax-inclusive) field pairs
 * documented in docs/DATA_DICTIONARY.md. Fuel is priced tax-inclusive by convention; other
 * items may be entered either way, so both directions are supported.
 */

export interface TaxSplit {
  pretax: number;
  taxAmount: number;
  inclusive: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function splitFromInclusive(inclusiveAmount: number, taxPercent: number): TaxSplit {
  const pretax = inclusiveAmount / (1 + taxPercent / 100);
  const taxAmount = inclusiveAmount - pretax;
  return { pretax: round2(pretax), taxAmount: round2(taxAmount), inclusive: round2(inclusiveAmount) };
}

export function splitFromPretax(pretaxAmount: number, taxPercent: number): TaxSplit {
  const taxAmount = pretaxAmount * (taxPercent / 100);
  const inclusive = pretaxAmount + taxAmount;
  return { pretax: round2(pretaxAmount), taxAmount: round2(taxAmount), inclusive: round2(inclusive) };
}

export function lineTotal(qty: number, rateInclusive: number, taxPercent: number) {
  const amount = round2(qty * rateInclusive);
  const split = splitFromInclusive(amount, taxPercent);
  return {
    rate: round2(rateInclusive),
    ratePretax: round2(rateInclusive - split.taxAmount / (qty || 1)),
    amount,
    taxPercent,
    taxAmount: split.taxAmount,
  };
}
