import { API_URL } from "./config";
import type {
  AppUser,
  AuditLog,
  BackupFile,
  Bill,
  BillLine,
  CashierSalesRow,
  Customer,
  CustomerLoginResponse,
  FinYear,
  FleetCardSalesRow,
  Granularity,
  Group,
  GroupItemSalesRow,
  GroupSalesRow,
  GstSummaryRow,
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
  Purchase,
  RateChange,
  Receipt,
  Role,
  SettingKey,
  Settings,
  SettleResponse,
  Shift,
  StockRow,
  StockSummaryRow,
  Tenant,
  VehicleSalesRow,
} from "@petropro/shared-types";

export type {
  AppUser,
  AuditLog,
  BackupFile,
  Bill,
  BillLine,
  CashierSalesRow,
  Customer,
  CustomerLoginResponse,
  FinYear,
  FleetCardSalesRow,
  Granularity,
  Group,
  GroupItemSalesRow,
  GroupSalesRow,
  GstSummaryRow,
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
  Purchase,
  RateChange,
  Receipt,
  Role,
  SettingKey,
  Settings,
  SettleResponse,
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

async function request<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError((data as { error?: string })?.error ?? res.statusText, res.status);
  }
  return data as T;
}

/** The API expects the JWT in an Authorization header, so plain <a href> downloads won't
 *  authenticate — fetch as a blob and hand the browser an object URL instead. */
export async function downloadAuthed(
  url: string,
  token: string,
  filename: string,
  mode: "open" | "save" = "save",
): Promise<void> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

export const api = {
  login: (user_id: string, password: string) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: { user_id, password } }),

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

  createUser: (token: string, body: { user_id: string; name: string; role: Role }) =>
    request<AppUser & { temporaryPassword?: string }>("/users", { method: "POST", token, body }),

  updateUser: (token: string, userId: string, body: { name: string; role: Role }) =>
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

  listCustomers: (token: string) => request<Customer[]>("/customers", { token }),

  getCustomer: (token: string, code: string) => request<Customer>(`/customers/${code}`, { token }),

  createCustomer: (
    token: string,
    body: { code: string; name: string; credit_limit?: number; service_charge?: number; email?: string },
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

  getMileageReport: (token: string, vehicleNo: string) =>
    request<MileageEntry[]>(`/reports/mileage?vehicle_no=${vehicleNo}`, { token }),

  getSalesReport: (
    token: string,
    groupBy: "item" | "cashier" | "group" | "group-items",
    from: string,
    to: string,
    granularity: Granularity,
  ) =>
    request<(ItemSalesRow | CashierSalesRow | GroupSalesRow | GroupItemSalesRow)[]>(
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

  listBackups: (token: string) => request<BackupFile[]>("/backup", { token }),

  createBackup: (token: string) => request<BackupFile>("/backup", { method: "POST", token, body: {} }),

  restoreBackup: (token: string, filename: string) =>
    request<{ restored: string }>("/backup/restore", { method: "POST", token, body: { filename, confirm: true } }),

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
};

/** The customer portal's own client — kept separate from `api` above since it authenticates
 *  with a customer session token (lib/customerAuth.ts), never a staff one. */
export const customerApi = {
  login: (email: string, password: string) =>
    request<CustomerLoginResponse>("/customer/auth/login", { method: "POST", body: { email, password } }),

  listOrders: (token: string) => request<Order[]>("/customer/orders", { token }),

  createOrder: (token: string, body: { lines: { item_code: string; qty: number }[] }) =>
    request<Order>("/customer/orders", { method: "POST", token, body }),

  cancelOrder: (token: string, orderNo: number) =>
    request<Order>(`/customer/orders/${orderNo}/cancel`, { method: "POST", token, body: {} }),
};
