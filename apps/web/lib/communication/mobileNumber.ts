/** Strips everything but digits and, for a bare 10-digit local number, prepends the deployment's
 *  default country code — so an operator can type either "9876543210" or "+91 98765 43210" and
 *  get the same wa.me-ready digit string. Returns null for anything too short to plausibly be a
 *  real mobile number (rather than guessing at a country code for a partial number). */
export function normalizeMobileNumber(raw: string | null | undefined, defaultCountryCode: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  if (digits.length > 10) return digits;
  return null;
}

/** Loose E.164-shaped length check (10-15 digits total, country code included) — this is a
 *  friendly sanity check for a manually-typed field, not real telecom validation. */
export function isValidMobileNumber(raw: string | null | undefined, defaultCountryCode: string): boolean {
  const normalized = normalizeMobileNumber(raw, defaultCountryCode);
  return normalized !== null && normalized.length >= 10 && normalized.length <= 15;
}
