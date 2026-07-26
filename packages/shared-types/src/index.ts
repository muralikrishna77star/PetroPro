/** Wire-format types shared between apps/api's HTTP responses and apps/web's consumption of
 *  them. These are deliberately the "API contract" shapes, not a 1:1 mirror of apps/api's
 *  internal repository types — the backend's DB-level types carry extra fields (e.g. Item's
 *  *_pretax/*_tax columns) that the frontend never needs. Previously apps/web/lib/api.ts
 *  hand-declared its own copies of these interfaces; this package is the single source so they
 *  can't drift out of sync silently. */

export type Role = "super_admin" | "owner" | "operator" | "field_operator";

export interface LoginResponse {
  token: string;
  user: { user_id: string; name: string; role: Role };
}

export interface Item {
  code: string;
  name: string;
  group_code: string | null;
  price_wholesale: number;
  price_retail: number;
  purchase_value: number;
  tax_percent: number;
  track_mileage: number;
}

export interface ItemInput {
  code: string;
  name: string;
  group_code?: string | null;
  price_wholesale: number;
  price_retail: number;
  purchase_value: number;
  track_mileage?: boolean;
  tax_percent: number;
}

export interface Group {
  code: string;
  name: string;
}

/** Pump count/naming is configured by admin/owner in Settings — no legacy analog. */
export interface Pump {
  code: string;
  name: string;
}

export interface AppUser {
  user_id: string;
  name: string;
  role: Role;
  active: number;
  created_at: string;
}

export interface PendingTransaction {
  id: number;
  vehicle_no: string;
  item_code: string;
  qty: number | null;
  amount: number | null;
  odometer: number | null;
  attendant_id: string;
  status: string;
  bill_no: number | null;
  created_at: string;
  client_ref: string | null;
  pump_code: string | null;
}

export interface BillLine {
  id: number;
  item_code: string;
  qty: number;
  rate: number;
  amount: number;
  tax_amount: number;
}

export interface Bill {
  bill_no: number;
  bill_date: string;
  vehicle_no: string | null;
  customer_code: string | null;
  sub_total: number;
  tax_total: number;
  grand_total: number;
  payment_type: string;
  status: string;
  cancelled_by: string | null;
  cancelled_at: string | null;
  order_no: string | null;
  pump_code: string | null;
}

export interface SettleResponse {
  bill: Bill;
  lines: BillLine[];
  amountInWords: string;
}

export interface Customer {
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  due_amount: number;
  credit_limit: number;
  service_charge: number;
  gst_no: string | null;
}

export interface Purchase {
  id: number;
  item_code: string;
  qty: number;
  value: number;
  pur_date: string;
  invoice_no: string | null;
  vat_amount: number;
}

export interface RateChange {
  id: number;
  item_code: string;
  rate: number;
  scheduled_on: string;
  applied: number;
  applied_at: string | null;
}

export interface Receipt {
  rec_no: number;
  rec_date: string;
  customer_code: string;
  amount: number;
  mode: string;
  cheque_no: string | null;
  bank_name: string | null;
  service_charge: number;
  cashier_id: string | null;
}

export interface LedgerEntry {
  date: string;
  type: "opening" | "bill" | "receipt" | "brought_forward";
  ref: string | number | null;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StockRow {
  item_code: string;
  sdate: string;
  opening: number;
  receipts: number;
  damaged: number;
  sales: number;
  closing: number;
  balance: number;
  closed: number;
}

export interface MileageEntry {
  id: number;
  bill_no: number;
  vehicle_no: string;
  item_code: string;
  odometer_prev: number | null;
  odometer_curr: number;
  qty: number;
  mileage: number | null;
  created_at: string;
}

export interface ItemSalesRow {
  bucket: string;
  item_code: string;
  item_name: string;
  qty: number;
  amount: number;
  tax_amount: number;
}

export interface CashierSalesRow {
  bucket: string;
  user_id: string;
  cashier_name: string;
  bill_count: number;
  amount: number;
}

export interface GroupSalesRow {
  bucket: string;
  group_code: string | null;
  group_name: string | null;
  qty: number;
  amount: number;
  tax_amount: number;
}

export interface VehicleSalesRow {
  vehicle_no: string;
  bill_count: number;
  amount: number;
}

export interface FleetCardSalesRow {
  fleet_card: string;
  bill_count: number;
  amount: number;
}

export interface GstSummaryRow {
  bucket: string;
  tax_percent: number;
  taxable_value: number;
  tax_amount: number;
  total: number;
}

export interface Tenant {
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  tagline: string | null;
  gst_no: string | null;
  /** Data URL of the outlet's existing UPI/payment QR code, configured in Settings — shown as-is
   *  for "upi" payments; no gateway integration, receipt is confirmed manually. */
  payment_qr_code: string | null;
}

export type SettingKey =
  | "KEROSENE"
  | "FLEETCARDENTRY"
  | "PRINTTESTMODE"
  | "PRINTSPECIALCHARACTERS"
  | "BILLENTRY"
  | "GSTNAMEADD";

export type Settings = Record<SettingKey, "YES" | "NO">;

export type Granularity = "day" | "month" | "year";

export interface Shift {
  id: number;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  status: "open" | "closed";
  notes: string | null;
}

export interface AuditLog {
  id: number;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  created_at: string;
}

export interface FinYear {
  fin_year_start: string;
}

export interface BackupFile {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}
