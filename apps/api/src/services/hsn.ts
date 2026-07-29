/**
 * HSN (Harmonized System of Nomenclature) code validation for Indian GST compliance.
 * Per CBIC notification 78/2020, tax invoices must declare HSN codes at 4 digits (turnover
 * up to Rs. 5 crore) or 6 digits (above Rs. 5 crore); 8 digits is used for export/import
 * customs declarations. All three lengths are numeric-only, so the item master accepts any
 * of them rather than pinning to one turnover bracket.
 */
const HSN_CODE_PATTERN = /^\d{4}$|^\d{6}$|^\d{8}$/;

/** hsn_code is optional on an item, so an empty/undefined value is treated as valid (absent). */
export function isValidHsnCode(hsnCode: string | null | undefined): boolean {
  if (hsnCode === null || hsnCode === undefined || hsnCode === "") return true;
  return HSN_CODE_PATTERN.test(hsnCode);
}
