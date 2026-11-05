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
  /** GST HSN code — 4, 6, or 8 numeric digits per CBIC invoicing rules; null if not set. */
  hsn_code: string | null;
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
  hsn_code?: string | null;
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
  /** Optional. An admin adding it lets this user's Google account with that verified address link. */
  email: string | null;
  /** 1 once a Google account is linked. The Google id itself is never sent to the browser. */
  google_linked: number;
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
  order_line_id: number | null;
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
  email: string | null;
  report_style: "legacy" | "modern";
}

/** A customer's own order-placement login (apps/api's routes/customerAuth.ts) — a separate
 *  audience from staff `LoginResponse`/`Role` above, never interchangeable with it. */
export interface CustomerLoginResponse {
  token: string;
  customer: { code: string; name: string };
}

export type OrderStatus = "open" | "partially_served" | "completed" | "cancelled";

export interface OrderLine {
  id: number;
  order_no: number;
  item_code: string;
  qty_ordered: number;
  qty_served: number;
  rate_at_order: number;
}

/** A customer-placed order, fulfilled incrementally across one or more Credit bills until every
 *  line's qty_served reaches qty_ordered — unrelated to `Bill.order_no`, which is just a
 *  free-text credit-sale reference string typed in by the cashier. */
export interface Order {
  order_no: number;
  customer_code: string;
  status: OrderStatus;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  lines: OrderLine[];
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

/** Opening/purchases/consumption/closing per item, bucketed by period (Day/Week/Month/Quarter/
 *  Half-Year/Year) — distinct from `StockRow`'s raw per-day rows, which carry the running
 *  `balance` the dashboard depends on. */
export interface StockSummaryRow {
  bucket: string;
  item_code: string;
  item_name: string;
  group_code: string | null;
  group_name: string | null;
  opening: number;
  purchases: number;
  consumption: number;
  closing: number;
}

/** One bill line on a Sales & Mileage report. The reading is empty where none was taken. */
export interface MileageReportRow {
  id: number;
  bill_no: number;
  bill_date: string;
  order_no: string | null;
  vehicle_no: string | null;
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  odometer_prev: number | null;
  odometer_curr: number | null;
  mileage: number | null;
}

export interface MileageReport {
  from: string;
  to: string;
  vehicle_no: string | null;
  rows: MileageReportRow[];
  bill_count: number;
  total_qty: number;
  total_amount: number;
  service_charge_percent: number;
  service_charge_amount: number;
  round_off: number;
  net_amount: number;
  amount_in_words: string;
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

/** Item-level rows carrying their group, so the report page can nest items beneath each group. */
export interface GroupItemSalesRow {
  bucket: string;
  group_code: string | null;
  group_name: string | null;
  item_code: string;
  item_name: string;
  qty: number;
  amount: number;
  tax_amount: number;
}

/** GST HSN summary (GSTR-1's HSN-wise table) — same shape as GstSummaryRow but keyed on the
 *  item's HSN code instead of its tax rate. `hsn_code` is null for items with none set. */
export interface HsnSalesRow {
  bucket: string;
  hsn_code: string | null;
  qty: number;
  taxable_value: number;
  tax_amount: number;
  total: number;
}

/** Item-level purchase rows carrying their group, mirroring GroupItemSalesRow for the
 *  purchases side of the group-wise reports. */
export interface PurchaseGroupItemRow {
  bucket: string;
  group_code: string | null;
  group_name: string | null;
  item_code: string;
  item_name: string;
  qty: number;
  value: number;
}

export interface VehicleSalesRow {
  vehicle_no: string;
  bill_count: number;
  amount: number;
}

/** Legacy CWS "Customer Wise Sales Report" (apps/api services/customerStatement.ts). `pages` is
 *  the print-ready fixed-width text, one string per line, `page_length` lines per page. */
export interface CustomerStatement {
  form: "CWS" | "CWSWO" | "CWSG" | "CWSGWO";
  customer: { code: string; name: string; service_charge: number };
  from: string;
  to: string;
  vehicle_no: string | null;
  lines: {
    bill_date: string;
    bill_no: number;
    order_no: string | null;
    vehicle_no: string | null;
    item_name: string;
    qty: number;
    rate: number;
    amount: number;
  }[];
  bill_count: number;
  total_qty: number;
  total_amount: number;
  service_charge_amount: number;
  opening_balance: number;
  receipts: number;
  net_balance: number;
  net_amount: number;
  round_off: number;
  amount_in_words: string;
  width: number;
  page_length: number;
  pages: string[][];
}

export interface CustomerStatementQuery {
  from: string;
  to: string;
  vehicleNo?: string;
  groupByVehicle?: boolean;
  withOpening?: boolean;
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
  | "GSTNAMEADD"
  | "AUTOBACKUP"
  | "OFFLINEMODE";

export type Settings = Record<SettingKey, "YES" | "NO">;

export type Granularity = "day" | "week" | "month" | "quarter" | "half-year" | "year";

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

/** WhatsApp Invoice Module (Community edition) — see
 *  PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf. `whatsapp_business`/`email`/`sms` are
 *  architected channels with no real backend yet (Professional edition); the frontend's
 *  CommunicationService always resolves them to a "coming soon" result. */
export type CommunicationChannel = "whatsapp" | "whatsapp_business" | "email" | "sms" | "share_pdf";

export type CommunicationStatus = "sent" | "failed";

export interface CommunicationSettings {
  whatsapp_enabled: boolean;
  default_country_code: string;
  /** Supports {customerName}, {tenantName}, {billNo}, {amount} placeholders. */
  message_template: string;
  /** Whether clicking WhatsApp opens wa.me immediately (once a valid number is known) or shows
   *  a confirm/edit step first. */
  auto_open_whatsapp: boolean;
  /** Stored for the Professional-edition provider architecture; not read by any active code path. */
  business_api_enabled: boolean;
  /** Offer "Send to my WhatsApp" on the QR-scanned invoice page (customer opts in there). */
  qr_whatsapp_enabled: boolean;
  /** Validity, in days, of the bill link sent that way (1-90). */
  qr_whatsapp_link_days: number;
}

export interface CommunicationLogEntry {
  id: number;
  bill_no: number;
  customer_code: string | null;
  mobile_number: string | null;
  channel: CommunicationChannel;
  status: CommunicationStatus;
  remarks: string | null;
  created_at: string;
}

/** A short-lived, single-bill link for the QR-code invoice flow (apps/api's
 *  routes/bills.ts `/bills/:billNo/share-link`) — `url` is what gets encoded into the QR image
 *  and opens apps/web's public `/i/[billNo]` page with no login required. */
export interface ShareLinkResponse {
  token: string;
  url: string;
  expiresInSeconds: number;
}

/** What apps/web's public `/i/[billNo]` page renders — same shape as `SettleResponse` plus the
 *  letterhead fields a signed-out viewer needs (apps/api's routes/publicInvoice.ts). */
export interface PublicInvoice {
  bill: Bill;
  lines: BillLine[];
  amountInWords: string;
  tenant: {
    name: string;
    address_line1: string | null;
    address_line2: string | null;
    tagline: string | null;
    gst_no: string | null;
  };
  /** Owner's Settings → Communication "QR: send to customer's WhatsApp" switch. */
  whatsapp: { enabled: boolean; default_country_code: string; link_days: number };
}

// ---------------------------------------------------------------------------------------------
// Technology & Subscription Dashboard (super_admin only — apps/api's routes/techDashboard.ts).
// ---------------------------------------------------------------------------------------------

export type TechCategory =
  | "frontend"
  | "backend"
  | "database"
  | "hosting"
  | "deployment"
  | "source_control"
  | "authentication"
  | "storage"
  | "monitoring"
  | "messaging"
  | "domains"
  | "documents"
  | "desktop";

/** How a component is paid for, as far as the codebase shows. Only `managed_service` can carry a
 *  subscription; the others are never billed by a provider. */
export type TechCostModel = "open_source" | "built_in" | "self_hosted" | "free_service" | "managed_service" | "not_in_use";

export type SubscriptionStatus = "active" | "trial" | "expired" | "cancelled" | "unknown";
export type BillingStatus = "paid" | "due" | "overdue" | "not_applicable" | "unknown";
export type BillingFrequency = "monthly" | "quarterly" | "annual" | "usage_based" | "one_time" | "none" | "unknown";
export type AutoRenew = "yes" | "no" | "unknown";

/** Which provider API, if any, can confirm part of a service's subscription. */
export type TechProviderIntegration = "vercel" | "github";

export interface TechServiceLink {
  label: string;
  url: string;
}

/** A super admin's manual record of a service's subscription. Every field is nullable — blank
 *  means "not recorded", shown as Unknown / Not configured, never guessed. */
export interface TechSubscriptionRecord {
  plan: string | null;
  account_owner: string | null;
  subscription_status: SubscriptionStatus;
  billing_status: BillingStatus;
  billing_frequency: BillingFrequency;
  amount: number | null;
  currency: string | null;
  next_payment_date: string | null;
  renewal_date: string | null;
  auto_renew: AutoRenew;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
}

export type TechSubscriptionInput = Omit<TechSubscriptionRecord, "updated_by" | "updated_at">;

/** Last result of asking the provider's API. `plan` is the only field any supported API
 *  confirms; subscription and billing status always stay manual. */
export interface TechProviderCheck {
  integration: TechProviderIntegration;
  checked_at: string;
  ok: boolean;
  plan: string | null;
  account: string | null;
  error: string | null;
}

export type TechAlertKind =
  | "overdue_payment"
  | "payment_due"
  | "payment_date_passed"
  | "upcoming_payment"
  | "upcoming_renewal"
  | "renewal_date_passed"
  | "no_auto_renew"
  | "trial_expiring"
  | "trial_ended"
  | "trial_no_end_date"
  | "inactive_critical"
  | "unrecorded_critical"
  | "plan_mismatch"
  | "provider_check_failed";

export interface TechAlert {
  service_id: string;
  service_name: string;
  kind: TechAlertKind;
  severity: "critical" | "warning" | "info";
  message: string;
  date: string | null;
}

export interface TechService {
  id: string;
  name: string;
  category: TechCategory;
  provider: string;
  cost_model: TechCostModel;
  critical: boolean;
  version: string | null;
  /** Where `version` came from: the running API process, or a package.json declaration. */
  version_source: "runtime" | "package.json" | "fly.toml" | null;
  purpose: string;
  used_in: string[];
  impact_if_unavailable: string;
  links: TechServiceLink[];
  /** Deployment facts read from config/env (region, app name, configured yes/no) — never secrets. */
  facts: { label: string; value: string }[];
  integration: { provider: TechProviderIntegration; configured: boolean; missing: string[]; verifies: string } | null;
  /** Catalog id of the service whose invoice this is charged on (e.g. the Fly volume → Fly.io). */
  billed_with: string | null;
  /** Whether a super admin can keep a subscription record for it (managed or free services
   *  that aren't billed with another entry). */
  can_record: boolean;
  subscription: TechSubscriptionRecord | null;
  provider_check: TechProviderCheck | null;
}

export interface TechCostTotal {
  currency: string;
  monthly: number;
  annual: number;
  service_count: number;
  /** How many of service_count are usage-based, so their amount is an estimate of a typical month. */
  usage_based_count: number;
}

export interface TechDashboard {
  generated_at: string;
  today: string;
  services: TechService[];
  alerts: TechAlert[];
  costs: {
    by_currency: TechCostTotal[];
    /** Active managed services whose cost can't be turned into a recurring estimate. */
    excluded: { service_id: string; service_name: string; reason: string }[];
  };
}

export type LegacyImportKind = "sales" | "stock" | "purchases" | "receipts" | "mileage";

export interface LegacyImportSkip {
  reason: string;
  count: number;
  /** A few distinct codes or dates to act on, not every occurrence. */
  examples: string[];
}

/** What an uploaded Petbill file holds against PetroPro, or what importing it did. */
export interface LegacyImportReport {
  filename: string;
  kind: LegacyImportKind | null;
  period: string | null;
  /** Why the whole file can't be imported, such as a wrong name or a damaged table. */
  blocked: string | null;
  rows: number;
  /** Bills for a sales file, otherwise rows. */
  to_import: number;
  to_import_lines: number;
  to_import_amount: number;
  already_present: number;
  skipped: LegacyImportSkip[];
  notes: string[];
  imported: boolean;
  backup: string | null;
}

export type PrinterConnection = "browser" | "bridge_lan" | "bridge_usb" | "webusb" | "bluetooth";
export type PrinterEncoding = "ascii" | "cp437" | "cp858";
export type PrintKind = "original" | "duplicate";
export type PrintJobStatus = "pending" | "sent" | "failed";

export interface ReceiptLogo {
  width: number;
  height: number;
  /** One bit per dot, row by row, as ESC/POS GS v 0 takes it. */
  raster_base64: string;
  preview_data_url: string;
}

/** What every receipt from this bunk says. */
export interface ReceiptSettings {
  /** Contact and statutory lines under the address. Nothing is assumed: an empty list prints nothing. */
  header_lines: string[];
  show_tagline: boolean;
  show_gstin: boolean;
  footer_text: string;
  logo: ReceiptLogo | null;
  qr_link_days: number;
  show_customer: boolean;
  show_vehicle: boolean;
  show_cashier: boolean;
  show_mileage: boolean;
  show_tax_breakup: boolean;
  festival_greetings: boolean;
  qty_decimals: number;
}

/** What one billing terminal prints on. */
export interface TerminalPrinterSettings {
  terminal_name: string;
  printer_name: string;
  printer_model: string;
  connection: PrinterConnection;
  host: string;
  port: number;
  windows_printer: string;
  paper_mm: 58 | 80;
  printable_mm: number;
  chars_per_line: number;
  encoding: PrinterEncoding;
  show_logo: boolean;
  show_qr: boolean;
  auto_cut: boolean;
  auto_print: boolean;
  copies: number;
}

export type ReceiptBlock =
  | { kind: "text"; text: string; align: "left" | "center" | "right"; bold?: boolean; double?: boolean }
  | { kind: "rule" }
  | { kind: "logo" }
  | { kind: "qr"; data: string };

export interface ReceiptDocument {
  width: number;
  blocks: ReceiptBlock[];
}

export interface PrintJob {
  id: number;
  bill_no: number;
  kind: PrintKind;
  status: PrintJobStatus;
  terminal_id: string | null;
  connection: string;
  copies: number;
  attempts: number;
  error: string | null;
  request_key: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PrintPayload {
  /** Null for a preview or test page, which aren't print jobs. */
  job: PrintJob | null;
  document: ReceiptDocument;
  text: string;
  escpos_base64: string;
  settings: TerminalPrinterSettings;
  logo_preview: string | null;
}
