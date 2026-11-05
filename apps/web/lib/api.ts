import { clearSession, getSession, saveSession } from "./auth";
import { API_URL } from "./config";
import type {
  AppUser,
  AuditLog,
  BackupFile,
  Bill,
  BillLine,
  CashierSalesRow,
  CommunicationChannel,
  CommunicationLogEntry,
  CommunicationSettings,
  CommunicationStatus,
  Customer,
  CustomerLoginResponse,
  CustomerStatement,
  CustomerStatementQuery,
  FinYear,
  FleetCardSalesRow,
  Granularity,
  Group,
  GroupItemSalesRow,
  GroupSalesRow,
  GstSummaryRow,
  HsnSalesRow,
  Item,
  ItemInput,
  ItemSalesRow,
  LedgerEntry,
  LoginResponse,
  MileageEntry,
  Order,
  OrderLine,
  PendingTransaction,
  Pump,
  PublicInvoice,
  Purchase,
  PurchaseGroupItemRow,
  RateChange,
  Receipt,
  Role,
  SettingKey,
  Settings,
  SettleResponse,
  ShareLinkResponse,
  Shift,
  StockRow,
  StockSummaryRow,
  Tenant,
  VehicleSalesRow,
  TechDashboard,
  TechService,
  TechAlert,
  TechSubscriptionInput,
  TechSubscriptionRecord,
  TechProviderCheck,
  SubscriptionStatus,
  BillingStatus,
  BillingFrequency,
  AutoRenew,
  TechCategory,
  TechCostModel,
  LegacyImportReport,
  PrintJob,
  PrintJobStatus,
  PrintPayload,
  ReceiptSettings,
  TerminalPrinterSettings,
} from "@petropro/shared-types";

export type {
  TechDashboard,
  TechService,
  TechAlert,
  TechSubscriptionInput,
  TechSubscriptionRecord,
  TechProviderCheck,
  SubscriptionStatus,
  BillingStatus,
  BillingFrequency,
  AutoRenew,
  TechCategory,
  TechCostModel,
  AppUser,
  AuditLog,
  BackupFile,
  Bill,
  BillLine,
  CashierSalesRow,
  CommunicationChannel,
  CommunicationLogEntry,
  CommunicationSettings,
  CommunicationStatus,
  Customer,
  CustomerLoginResponse,
  CustomerStatement,
  CustomerStatementQuery,
  FinYear,
  FleetCardSalesRow,
  Granularity,
  Group,
  GroupItemSalesRow,
  GroupSalesRow,
  GstSummaryRow,
  HsnSalesRow,
  Item,
  ItemInput,
  ItemSalesRow,
  LedgerEntry,
  LoginResponse,
  MileageEntry,
  Order,
  OrderLine,
  PendingTransaction,
  Pump,
  PublicInvoice,
  Purchase,
  PurchaseGroupItemRow,
  RateChange,
  Receipt,
  Role,
  SettingKey,
  Settings,
  SettleResponse,
  ShareLinkResponse,
  Shift,
  StockRow,
  StockSummaryRow,
  Tenant,
  VehicleSalesRow,
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** The API's session routes, through this site's own origin (next.config.ts). */
const SESSION_API = "/session-api";

let refreshInFlight: Promise<string | null> | null = null;

/** Sends the session's refresh cookie for a new access token. Null means the session has ended;
 *  anything transient (offline, the API restarting) rejects instead, so nobody gets signed out by it. */
async function requestNewAccessToken(staleToken: string): Promise<string | null> {
  const current = getSession();
  if (!current) return null;
  if (current.token !== staleToken) return current.token; // another tab already renewed it

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${SESSION_API}/refresh`, { method: "POST" });
    if (res.ok) {
      const { token, user } = (await res.json()) as LoginResponse;
      saveSession({ token, userId: user.user_id, name: user.name, role: user.role });
      return token;
    }
    if (res.status === 401) return null;
    if (res.status !== 409) throw new ApiError(res.statusText || "Could not renew the session", res.status);
    await new Promise((resolve) => setTimeout(resolve, 500)); // another tab is mid-renewal
  }
  throw new ApiError("Could not renew the session", 409);
}

/** One renewal at a time, across all of this browser's tabs where it supports locks. */
function renewAccessToken(staleToken: string): Promise<string | null> {
  const run = async () =>
    navigator.locks
      ? ((await navigator.locks.request("petropro.refresh", () => requestNewAccessToken(staleToken))) as string | null)
      : requestNewAccessToken(staleToken);
  const renewal: Promise<string | null> = refreshInFlight ?? run().finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = renewal;
  return renewal;
}

function sessionEnded(): void {
  clearSession();
  if (window.location.pathname !== "/login") window.location.assign("/login?error=session_expired");
}

/**
 * fetch with a staff access token. Always sends the newest token, not the one a page captured when
 * it opened, and on a 401 renews it once and retries, so the short token lifetime stays invisible.
 * Customer and QR-link tokens are other audiences with no session behind them: `/customer/` calls pass through.
 */
export async function authedFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const isStaffCall = !url.startsWith(`${API_URL}/customer/`);
  const send = (bearer: string) =>
    fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${bearer}` } });

  const bearer = isStaffCall ? (getSession()?.token ?? token) : token;
  const res = await send(bearer);
  if (res.status !== 401 || !isStaffCall) return res;

  const renewed = await renewAccessToken(bearer);
  if (renewed) return send(renewed);
  sessionEnded();
  return res;
}

async function request<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    // Only with a body: Fastify answers 400 to a JSON content type on an empty DELETE.
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : {},
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  };
  const url = `${API_URL}${path}`;
  const res = options.token ? await authedFetch(url, options.token, init) : await fetch(url, init);

  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError((data as { error?: string })?.error ?? res.statusText, res.status);
  }
  return data as T;
}

/** A call that starts a session: same-origin, so the browser accepts the refresh cookie it sets. */
async function sessionRequest(path: string, body: unknown): Promise<LoginResponse> {
  const res = await fetch(`${SESSION_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? res.statusText, res.status);
  return data as LoginResponse;
}

/** The API expects the JWT in an Authorization header, so plain <a href> downloads won't
 *  authenticate — fetch as a blob and hand the browser an object URL instead. */
export async function downloadAuthed(
  url: string,
  token: string,
  filename: string,
  mode: "open" | "save" = "save",
): Promise<void> {
  const res = await authedFetch(url, token);
  if (!res.ok) throw new ApiError("Download failed", res.status);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  if (mode === "open") {
    window.open(objectUrl, "_blank");
  } else {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

/** The raw file is the request body, so a whole table isn't re-encoded on its way up. */
async function sendLegacyFile(path: string, token: string, file: File, params: Record<string, string> = {}): Promise<LegacyImportReport> {
  const query = new URLSearchParams({ filename: file.name, ...params });
  const res = await authedFetch(`${API_URL}/legacy-import/${path}?${query}`, token, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? res.statusText, res.status);
  return data as LegacyImportReport;
}

function statementParams(query: CustomerStatementQuery): URLSearchParams {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.vehicleNo) params.set("vehicle_no", query.vehicleNo);
  if (query.groupByVehicle) params.set("group_by_vehicle", "1");
  if (query.withOpening) params.set("with_opening", "1");
  return params;
}

export const api = {
  login: (user_id: string, password: string) => sessionRequest("/login", { user_id, password }),

  /** Finishes a Google sign-in for a user whose Google account is already linked. */
  googleExchange: (ticket: string) => sessionRequest("/google/exchange", { ticket }),

  /** First sign-in with a Google account: links it once the PetroPro password is confirmed. */
  googleLink: (ticket: string, password: string) => sessionRequest("/google/link", { ticket, password }),

  /** Ends this device's session on the server, so its cookie stops working even if copied. */
  logout: () => fetch(`${SESSION_API}/logout`, { method: "POST" }),

  listItems: (token: string) => request<Item[]>("/items", { token }),

  createItem: (token: string, body: ItemInput) => request<Item>("/items", { method: "POST", token, body }),

  updateItem: (token: string, code: string, body: Omit<ItemInput, "code">) =>
    request<Item>(`/items/${code}`, { method: "PUT", token, body }),

  listGroups: (token: string) => request<Group[]>("/groups", { token }),

  createGroup: (token: string, body: Group) => request<Group>("/groups", { method: "POST", token, body }),

  updateGroup: (token: string, code: string, name: string) =>
    request<Group>(`/groups/${code}`, { method: "PUT", token, body: { name } }),

  listPumps: (token: string) => request<Pump[]>("/pumps", { token }),

  createPump: (token: string, body: Pump) => request<Pump>("/pumps", { method: "POST", token, body }),

  updatePump: (token: string, code: string, name: string) =>
    request<Pump>(`/pumps/${code}`, { method: "PUT", token, body: { name } }),

  listUsers: (token: string) => request<AppUser[]>("/users", { token }),

  unlinkGoogle: (token: string, userId: string) =>
    request<{ ok: true }>(`/users/${userId}/google-link`, { method: "DELETE", token }),

  createUser: (token: string, body: { user_id: string; name: string; role: Role; email?: string | null }) =>
    request<AppUser & { temporaryPassword?: string }>("/users", { method: "POST", token, body }),

  updateUser: (token: string, userId: string, body: { name: string; role: Role; email?: string | null }) =>
    request<AppUser>(`/users/${userId}`, { method: "PUT", token, body }),

  deactivateUser: (token: string, userId: string) =>
    request<AppUser>(`/users/${userId}/deactivate`, { method: "POST", token, body: {} }),

  reactivateUser: (token: string, userId: string) =>
    request<AppUser>(`/users/${userId}/reactivate`, { method: "POST", token, body: {} }),

  resetUserPassword: (token: string, userId: string) =>
    request<{ user_id: string; temporaryPassword: string }>(`/users/${userId}/reset-password`, {
      method: "POST",
      token,
      body: {},
    }),

  listPendingTransactions: (token: string) =>
    request<PendingTransaction[]>("/pending-transactions", { token }),

  createPendingTransaction: (
    token: string,
    body: {
      vehicle_no: string;
      item_code: string;
      qty?: number;
      amount?: number;
      odometer?: number;
      client_ref?: string;
      pump_code?: string;
    },
  ) => request<PendingTransaction>("/pending-transactions", { method: "POST", token, body }),

  settleBill: (
    token: string,
    body: { pendingId: number; paymentType: string; extraLines?: { item_code: string; qty: number }[] },
  ) => request<SettleResponse>("/bills/settle", { method: "POST", token, body }),

  createWalkInBill: (
    token: string,
    body: {
      paymentType: string;
      customerCode?: string;
      vehicleNo?: string;
      orderNo?: string;
      fulfillOrderNo?: number;
      pumpCode?: string;
      clientRef?: string;
      lines: {
        item_code: string;
        qty: number;
        odometer?: number;
        odometerOpening?: number;
        orderLineId?: number;
      }[];
    },
  ) => request<SettleResponse>("/bills", { method: "POST", token, body }),

  getBill: (token: string, billNo: number) => request<SettleResponse>(`/bills/${billNo}`, { token }),

  getRecentBills: (token: string, limit = 5) => request<Bill[]>(`/bills/recent?limit=${limit}`, { token }),

  getLastBill: (token: string, filter: { vehicleNo?: string; customerCode?: string }) => {
    const params = new URLSearchParams();
    if (filter.vehicleNo) params.set("vehicle_no", filter.vehicleNo);
    if (filter.customerCode) params.set("customer_code", filter.customerCode);
    return request<SettleResponse>(`/bills/last?${params}`, { token });
  },

  cancelBill: (token: string, billNo: number) => request<Bill>(`/bills/${billNo}/cancel`, { method: "POST", token }),

  invoicePdfUrl: (billNo: number) => `${API_URL}/bills/${billNo}/pdf`,

  getShareLink: (token: string, billNo: number) =>
    request<ShareLinkResponse>(`/bills/${billNo}/share-link`, { token }),

  listCustomers: (token: string) => request<Customer[]>("/customers", { token }),

  getCustomer: (token: string, code: string) => request<Customer>(`/customers/${code}`, { token }),

  createCustomer: (
    token: string,
    body: {
      code: string;
      name: string;
      credit_limit?: number;
      service_charge?: number;
      email?: string;
      phone?: string;
    },
  ) => request<Customer>("/customers", { method: "POST", token, body }),

  updateCustomer: (
    token: string,
    code: string,
    body: {
      name: string;
      address?: string | null;
      print_name?: string | null;
      phone?: string | null;
      credit_limit?: number;
      service_charge?: number;
      tin_no?: string | null;
      gst_no?: string | null;
      email?: string | null;
      joined_on?: string | null;
    },
  ) => request<Customer>(`/customers/${code}`, { method: "PUT", token, body }),

  setCustomerReportStyle: (token: string, code: string, report_style: "legacy" | "modern") =>
    request<Customer>(`/customers/${code}/report-style`, { method: "PUT", token, body: { report_style } }),

  setCustomerPassword: (token: string, code: string) =>
    request<{ code: string; temporaryPassword: string }>(`/customers/${code}/set-password`, {
      method: "POST",
      token,
      body: {},
    }),

  setOpeningBalance: (token: string, code: string, body: { op_date: string; op_balance: number }) =>
    request(`/customers/${code}/opening-balance`, { method: "POST", token, body }),

  /** A customer's pending orders (open/partially served) — used by the Billing page's Pending
   *  Order section when fulfilling a Credit sale. */
  listCustomerOrders: (token: string, customerCode: string) =>
    request<Order[]>(`/orders?customer_code=${customerCode}`, { token }),

  listPurchases: (token: string, itemCode?: string) =>
    request<Purchase[]>(`/purchases${itemCode ? `?item_code=${itemCode}` : ""}`, { token }),

  createPurchase: (
    token: string,
    body: { item_code: string; qty: number; value: number; invoice_no?: string },
  ) => request<Purchase>("/purchases", { method: "POST", token, body }),

  listRateChanges: (token: string, pendingOnly?: boolean) =>
    request<RateChange[]>(`/rate-changes${pendingOnly ? "?pending=true" : ""}`, { token }),

  createRateChange: (token: string, body: { item_code: string; rate: number; scheduled_on: string }) =>
    request<RateChange>("/rate-changes", { method: "POST", token, body }),

  applyDueRateChanges: (token: string) =>
    request<RateChange[]>("/rate-changes/apply-due", { method: "POST", token, body: {} }),

  deleteRateChange: (token: string, id: number) =>
    request<void>(`/rate-changes/${id}`, { method: "DELETE", token }),

  listReceipts: (token: string, customerCode: string) =>
    request<Receipt[]>(`/receipts?customer_code=${customerCode}`, { token }),

  createReceipt: (
    token: string,
    body: { customer_code: string; amount: number; mode: string; cheque_no?: string; bank_name?: string },
  ) => request<Receipt>("/receipts", { method: "POST", token, body }),

  receiptPdfUrl: (recNo: number) => `${API_URL}/receipts/${recNo}/pdf`,

  getCustomerLedger: (token: string, code: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return request<LedgerEntry[]>(`/reports/customers/${code}/ledger?${params}`, { token });
  },

  getCustomerStatement: (token: string, code: string, query: CustomerStatementQuery) =>
    request<CustomerStatement>(`/reports/customers/${encodeURIComponent(code)}/statement?${statementParams(query)}`, {
      token,
    }),

  customerStatementPdfUrl: (code: string, query: CustomerStatementQuery) =>
    `${API_URL}/reports/customers/${encodeURIComponent(code)}/statement.pdf?${statementParams(query)}`,

  getStockReport: (token: string, from: string, to: string, itemCode?: string) => {
    const params = new URLSearchParams({ from, to });
    if (itemCode) params.set("item_code", itemCode);
    return request<StockRow[]>(`/reports/stock?${params}`, { token });
  },

  getStockSummary: (token: string, from: string, to: string, granularity: Granularity, itemCode?: string) => {
    const params = new URLSearchParams({ from, to, granularity });
    if (itemCode) params.set("item_code", itemCode);
    return request<StockSummaryRow[]>(`/reports/stock-summary?${params}`, { token });
  },

  getPurchaseReport: (token: string, from: string, to: string, itemCode?: string) => {
    const params = new URLSearchParams({ from, to });
    if (itemCode) params.set("item_code", itemCode);
    return request<Purchase[]>(`/reports/purchases?${params}`, { token });
  },

  getPurchasesByGroup: (token: string, from: string, to: string, granularity: Granularity) =>
    request<PurchaseGroupItemRow[]>(
      `/reports/purchases-by-group?from=${from}&to=${to}&granularity=${granularity}`,
      { token },
    ),

  getCustomerMileage: (token: string, code: string, query: CustomerStatementQuery) =>
    request<{ from: string; to: string; vehicle_no: string | null; rows: (MileageEntry & { bill_date: string; item_name: string })[] }>(`/reports/customers/${encodeURIComponent(code)}/mileage?${statementParams(query)}`, { token }),

  getMileageReport: (token: string, vehicleNo: string) =>
    request<MileageEntry[]>(`/reports/mileage?vehicle_no=${vehicleNo}`, { token }),

  getSalesReport: (
    token: string,
    groupBy: "item" | "cashier" | "group" | "group-items" | "hsn",
    from: string,
    to: string,
    granularity: Granularity,
  ) =>
    request<(ItemSalesRow | CashierSalesRow | GroupSalesRow | GroupItemSalesRow | HsnSalesRow)[]>(
      `/reports/sales?groupBy=${groupBy}&from=${from}&to=${to}&granularity=${granularity}`,
      { token },
    ),

  getBillRegister: (token: string, from: string, to: string, status?: string) => {
    const params = new URLSearchParams({ from, to });
    if (status) params.set("status", status);
    return request<Bill[]>(`/reports/bills?${params}`, { token });
  },

  getVehicleSales: (token: string, from: string, to: string) =>
    request<VehicleSalesRow[]>(`/reports/vehicles?from=${from}&to=${to}`, { token }),

  getFleetCardSales: (token: string, from: string, to: string) =>
    request<FleetCardSalesRow[]>(`/reports/fleet-cards?from=${from}&to=${to}`, { token }),

  getGstSummary: (token: string, from: string, to: string, granularity: Granularity) =>
    request<GstSummaryRow[]>(`/reports/gst?from=${from}&to=${to}&granularity=${granularity}`, { token }),

  gstExcelUrl: (from: string, to: string, granularity: Granularity) =>
    `${API_URL}/reports/gst.xlsx?from=${from}&to=${to}&granularity=${granularity}`,

  getTenant: (token: string) => request<Tenant>("/tenant", { token }),

  updateTenant: (token: string, body: Tenant) => request<Tenant>("/tenant", { method: "PUT", token, body }),

  getSettings: (token: string) => request<Settings>("/settings", { token }),

  updateSettings: (token: string, body: Partial<Settings>) =>
    request<Settings>("/settings", { method: "PUT", token, body }),

  listShifts: (token: string) => request<Shift[]>("/shifts", { token }),

  getCurrentShift: (token: string) => request<Shift | null>("/shifts/current", { token }),

  openShift: (token: string, opening_cash: number) =>
    request<Shift>("/shifts/open", { method: "POST", token, body: { opening_cash } }),

  closeShift: (token: string, shiftId: number, body: { closing_cash: number; notes?: string }) =>
    request<Shift>(`/shifts/${shiftId}/close`, { method: "POST", token, body }),

  listAuditLogs: (token: string, filter: { userId?: string; entityType?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.userId) params.set("user_id", filter.userId);
    if (filter.entityType) params.set("entity_type", filter.entityType);
    return request<AuditLog[]>(`/audit-logs?${params}`, { token });
  },

  getFinYear: (token: string) => request<FinYear>("/fin-year", { token }),

  setFinYear: (token: string, fin_year_start: string) =>
    request<FinYear>("/fin-year", { method: "PUT", token, body: { fin_year_start } }),

  bulkTaxChange: (token: string, body: { tax_percent: number; group_code?: string }) =>
    request<Item[]>("/items/bulk-tax-change", { method: "POST", token, body }),

  previewLegacyFile: (token: string, file: File) => sendLegacyFile("preview", token, file),

  commitLegacyFile: (token: string, file: File, withBackup: boolean) =>
    sendLegacyFile("commit", token, file, withBackup ? { backup: "1" } : {}),

  getReceiptSettings: (token: string) => request<ReceiptSettings>("/print/settings", { token }),

  saveReceiptSettings: (token: string, body: ReceiptSettings) =>
    request<ReceiptSettings>("/print/settings", { method: "PUT", token, body }),

  getTerminalPrinter: (token: string, terminalId: string) =>
    request<TerminalPrinterSettings>(`/print/terminals/${terminalId}`, { token }),

  saveTerminalPrinter: (token: string, terminalId: string, body: TerminalPrinterSettings) =>
    request<TerminalPrinterSettings>(`/print/terminals/${terminalId}`, { method: "PUT", token, body }),

  listPrintTerminals: (token: string) =>
    request<{ terminal_id: string; settings: TerminalPrinterSettings; updated_at: string }[]>("/print/terminals", { token }),

  testPrint: (token: string, settings: TerminalPrinterSettings) =>
    request<PrintPayload>("/print/test", { method: "POST", token, body: { settings } }),

  previewReceipt: (token: string, billNo: number, terminalId: string) =>
    request<PrintPayload>(`/bills/${billNo}/receipt?terminal_id=${terminalId}`, { token }),

  billReceiptPdfUrl: (billNo: number, terminalId: string) => `${API_URL}/bills/${billNo}/receipt.pdf?terminal_id=${terminalId}`,

  listBillPrintJobs: (token: string, billNo: number) => request<PrintJob[]>(`/bills/${billNo}/print-jobs`, { token }),

  requestPrint: (token: string, billNo: number, body: { request_key: string; terminal_id: string }) =>
    request<PrintPayload>(`/bills/${billNo}/print-jobs`, { method: "POST", token, body }),

  retryPrintJob: (token: string, jobId: number, body: { terminal_id: string; connection?: string }) =>
    request<PrintPayload>(`/print-jobs/${jobId}/retry`, { method: "POST", token, body }),

  reportPrintJob: (token: string, jobId: number, status: PrintJobStatus, error: string | null) =>
    request<PrintJob>(`/print-jobs/${jobId}`, { method: "PATCH", token, body: { status, error: error ?? undefined } }),

  listBackups: (token: string) => request<BackupFile[]>("/backup", { token }),

  createBackup: (token: string) => request<BackupFile>("/backup", { method: "POST", token, body: {} }),

  restoreBackup: (token: string, filename: string) =>
    request<{ restored: string }>("/backup/restore", { method: "POST", token, body: { filename, confirm: true } }),

  backupDownloadUrl: (filename: string) => `${API_URL}/backup/${filename}/download`,

  resetTransactionalData: (token: string) =>
    request<{ backup: BackupFile; clearedTables: string[]; finYearStart: string }>("/data-reset", {
      method: "POST",
      token,
      body: { confirm: true },
    }),

  getBusinessDate: (token: string) => request<{ date: string }>("/business-date", { token }),

  closeDay: (token: string) =>
    request<{ closedDate: string; rowsClosed: number; runningDate: string }>("/stock/close", {
      method: "POST",
      token,
      body: {},
    }),

  getCommunicationSettings: (token: string) => request<CommunicationSettings>("/communication/settings", { token }),

  updateCommunicationSettings: (token: string, body: Partial<CommunicationSettings>) =>
    request<CommunicationSettings>("/communication/settings", { method: "PUT", token, body }),

  logCommunication: (
    token: string,
    body: {
      bill_no: number;
      customer_code?: string | null;
      mobile_number?: string | null;
      channel: CommunicationChannel;
      status: CommunicationStatus;
      remarks?: string | null;
    },
  ) => request<CommunicationLogEntry>("/communication/log", { method: "POST", token, body }),

  getCommunicationLog: (token: string, billNo?: number) =>
    request<CommunicationLogEntry[]>(`/communication/log${billNo ? `?bill_no=${billNo}` : ""}`, { token }),
};

/** The customer portal's own client — kept separate from `api` above since it authenticates
 *  with a customer session token (lib/customerAuth.ts), never a staff one. */
export interface CustomerReport {
  customer: { code: string; name: string };
  from: string;
  to: string;
  credit_limit: number;
  opening_balance: number;
  closing_balance: number;
  ledger: LedgerEntry[];
  purchases: { bill_no: number; bill_date: string; vehicle_no: string | null; payment_type: string; grand_total: number }[];
}

export const customerApi = {
  getStatement: (token: string, query: CustomerStatementQuery) =>
    request<CustomerStatement>(`/customer/reports/statement?${statementParams(query)}`, { token }),
  statementPdfUrl: (query: CustomerStatementQuery) => `${API_URL}/customer/reports/statement.pdf?${statementParams(query)}`,
  getMileage: (token: string, query: CustomerStatementQuery) =>
    request<{ from: string; to: string; vehicle_no: string | null; rows: (MileageEntry & { bill_date: string; item_name: string })[] }>(`/customer/reports/mileage?${statementParams(query)}`, { token }),

  googleComplete: (ticket: string, kind: string, password?: string) =>
    request<CustomerLoginResponse>("/customer/auth/google/complete", { method: "POST", body: { ticket, kind, password } }),

  getReport: (token: string, from: string, to: string) =>
    request<CustomerReport>(`/customer/reports?${new URLSearchParams({ from, to })}`, { token }),

  login: (email: string, password: string) =>
    request<CustomerLoginResponse>("/customer/auth/login", { method: "POST", body: { email, password } }),

  listOrders: (token: string) => request<Order[]>("/customer/orders", { token }),

  createOrder: (token: string, body: { lines: { item_code: string; qty: number }[] }) =>
    request<Order>("/customer/orders", { method: "POST", token, body }),

  cancelOrder: (token: string, orderNo: number) =>
    request<Order>(`/customer/orders/${orderNo}/cancel`, { method: "POST", token, body: {} }),
};

export const techApi = {
  getDashboard: (token: string) => request<TechDashboard>("/tech-dashboard", { token }),

  getHistory: (token: string, serviceId: string) =>
    request<AuditLog[]>(`/tech-dashboard/services/${encodeURIComponent(serviceId)}/history`, { token }),

  saveSubscription: (token: string, serviceId: string, body: TechSubscriptionInput) =>
    request<TechSubscriptionRecord>(`/tech-dashboard/services/${encodeURIComponent(serviceId)}/subscription`, {
      method: "PUT",
      token,
      body,
    }),

  clearSubscription: (token: string, serviceId: string) =>
    request<{ ok: true }>(`/tech-dashboard/services/${encodeURIComponent(serviceId)}/subscription`, {
      method: "DELETE",
      token,
    }),

  verify: (token: string, serviceId: string) =>
    request<TechProviderCheck>(`/tech-dashboard/services/${encodeURIComponent(serviceId)}/verify`, {
      method: "POST",
      token,
      body: {},
    }),
};

/** The QR-code invoice flow's client (apps/web/app/i/[billNo]/page.tsx) — no session token at
 *  all, staff or customer; the bill-scoped `t` query param (from `api.getShareLink`) is the only
 *  credential, so these hit apps/api's routes/publicInvoice.ts directly rather than going
 *  through `request()`'s Authorization-header plumbing. */
export const publicApi = {
  getInvoice: (billNo: number, t: string) =>
    request<PublicInvoice>(`/public/invoice/${billNo}?t=${encodeURIComponent(t)}`),

  invoicePdfUrl: (billNo: number, t: string) => `${API_URL}/public/invoice/${billNo}/pdf?t=${encodeURIComponent(t)}`,

  sendToWhatsApp: (billNo: number, t: string, mobileNumber: string) =>
    request<{ whatsappUrl: string; expiresInDays: number }>(
      `/public/invoice/${billNo}/whatsapp?t=${encodeURIComponent(t)}`,
      { method: "POST", body: { mobile_number: mobileNumber } },
    ),
};
