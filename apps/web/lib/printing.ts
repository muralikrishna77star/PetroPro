import QRCode from "qrcode";
import type { PrintJobStatus, PrintPayload, ReceiptDocument } from "@petropro/shared-types";
import { api, ApiError } from "./api";

const TERMINAL_KEY = "petropro.print.terminal";
const BRIDGE_KEY = "petropro.print.bridge";
const REPORTS_KEY = "petropro.print.reports";
const FAILED_KEY = "petropro.print.failed";
const MAX_FAILED = 10;
const BRIDGE_TIMEOUT_MS = 40_000;

/** Common BLE services that Bluetooth thermal printers expose for writing raw bytes. */
const BLUETOOTH_SERVICES = [0x18f0, "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455"];
const BLUETOOTH_CHUNK = 180;
const USB_CHUNK = 16384;
const USB_PRINTER_CLASS = 7;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and full storage. Printing still works, only recovery after a restart doesn't.
  }
}

/** Identifies this browser as a billing terminal, so each can have its own printer. */
export function getTerminalId(): string {
  let id = readJson<string | null>(TERMINAL_KEY, null);
  if (!id) {
    id = crypto.randomUUID();
    writeJson(TERMINAL_KEY, id);
  }
  return id;
}

export interface BridgeConfig {
  url: string;
  token: string;
}

/** Kept on this device only, because the token is what lets a page reach this computer's printers. */
export function getBridgeConfig(): BridgeConfig {
  return readJson<BridgeConfig>(BRIDGE_KEY, { url: "http://127.0.0.1:9147", token: "" });
}

export function saveBridgeConfig(config: BridgeConfig): void {
  writeJson(BRIDGE_KEY, config);
}

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function callBridge(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, token } = getBridgeConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    return await fetch(`${url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { ...init.headers, "Content-Type": "application/json", "X-Bridge-Token": token },
    });
  } catch {
    throw new Error("The print bridge isn't answering on this computer. Check that it's running.");
  } finally {
    clearTimeout(timer);
  }
}

export async function checkBridge(): Promise<{ version: string; printers: string[] }> {
  const health = await callBridge("/health");
  if (!health.ok) throw new Error(((await health.json().catch(() => null)) as { error?: string } | null)?.error ?? "The bridge refused this site");
  const { version } = (await health.json()) as { version: string };
  const list = await callBridge("/printers");
  if (!list.ok) throw new Error(((await list.json().catch(() => null)) as { error?: string } | null)?.error ?? "The bridge refused the token");
  return { version, printers: ((await list.json()) as { printers: string[] }).printers };
}

async function sendViaBridge(payload: PrintPayload, jobKey: string | null): Promise<void> {
  const { settings } = payload;
  const target = settings.connection === "bridge_lan" ? { type: "lan", host: settings.host, port: settings.port } : { type: "usb", printer: settings.windows_printer };
  const res = await callBridge("/print", {
    method: "POST",
    body: JSON.stringify({ job_key: jobKey, target, data_base64: payload.escpos_base64 }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The print bridge couldn't print this");
}

/* eslint-disable @typescript-eslint/no-explicit-any -- WebUSB and Web Bluetooth aren't in TypeScript's DOM types */
async function sendViaWebUsb(bytes: Uint8Array): Promise<void> {
  const usb = (navigator as any).usb;
  if (!usb) throw new Error("This browser can't reach USB printers directly. Use Chrome or Edge, or the print bridge.");
  const [known] = await usb.getDevices();
  const device = known ?? (await usb.requestDevice({ filters: [{ classCode: USB_PRINTER_CLASS }] }));
  await device.open();
  try {
    if (!device.configuration) await device.selectConfiguration(1);
    let interfaceNumber: number | null = null;
    let endpointNumber: number | null = null;
    for (const iface of device.configuration.interfaces) {
      for (const alternate of iface.alternates) {
        const out = alternate.endpoints.find((e: any) => e.direction === "out");
        if (alternate.interfaceClass === USB_PRINTER_CLASS && out && endpointNumber === null) {
          interfaceNumber = iface.interfaceNumber;
          endpointNumber = out.endpointNumber;
        }
      }
    }
    if (interfaceNumber === null || endpointNumber === null) throw new Error("That USB device isn't a printer this browser can use.");
    await device.claimInterface(interfaceNumber);
    try {
      for (let at = 0; at < bytes.length; at += USB_CHUNK) {
        const result = await device.transferOut(endpointNumber, bytes.subarray(at, at + USB_CHUNK));
        if (result.status !== "ok") throw new Error("The printer stopped accepting data.");
      }
    } finally {
      await device.releaseInterface(interfaceNumber);
    }
  } finally {
    await device.close();
  }
}

let bluetoothWriter: any = null;

async function sendViaBluetooth(bytes: Uint8Array): Promise<void> {
  const bluetooth = (navigator as any).bluetooth;
  if (!bluetooth) throw new Error("This browser can't use Bluetooth printers. Use Chrome on Android or a computer.");
  if (!bluetoothWriter?.service?.device?.gatt?.connected) {
    const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLUETOOTH_SERVICES });
    const server = await device.gatt.connect();
    bluetoothWriter = null;
    for (const service of await server.getPrimaryServices()) {
      for (const characteristic of await service.getCharacteristics()) {
        if (!bluetoothWriter && (characteristic.properties.write || characteristic.properties.writeWithoutResponse)) bluetoothWriter = characteristic;
      }
    }
    if (!bluetoothWriter) throw new Error("That Bluetooth device doesn't accept print data.");
  }
  for (let at = 0; at < bytes.length; at += BLUETOOTH_CHUNK) {
    const chunk = bytes.subarray(at, at + BLUETOOTH_CHUNK);
    if (bluetoothWriter.properties.writeWithoutResponse) await bluetoothWriter.writeValueWithoutResponse(chunk);
    else await bluetoothWriter.writeValueWithResponse(chunk);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

async function receiptHtml(doc: ReceiptDocument, payload: PrintPayload): Promise<string> {
  const { settings } = payload;
  const fontMm = Math.min(settings.printable_mm, settings.paper_mm) / doc.width / 0.6;
  const rows: string[] = [];
  for (const block of doc.blocks) {
    if (block.kind === "rule") rows.push(`<div>${"-".repeat(doc.width)}</div>`);
    else if (block.kind === "logo") {
      if (payload.logo_preview) rows.push(`<div class="c"><img class="logo" src="${payload.logo_preview}" alt="" /></div>`);
    } else if (block.kind === "qr") {
      rows.push(`<div class="c"><img class="qr" src="${await QRCode.toDataURL(block.data, { margin: 1, width: 240 })}" alt="" /></div>`);
    } else {
      const classes = [block.align === "center" ? "c" : block.align === "right" ? "r" : "", block.bold ? "b" : "", block.double ? "d" : ""].join(" ");
      rows.push(`<div class="${classes}">${escapeHtml(block.text)}</div>`);
    }
  }
  return `<!doctype html><html><head><title>Receipt</title><style>
    @page { size: ${settings.paper_mm}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { width: ${settings.printable_mm}mm; margin: 0 auto; padding: 2mm 0; font: ${fontMm.toFixed(3)}mm/1.25 "Courier New", Courier, monospace; }
    div { white-space: pre; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; } .d { font-size: 2em; }
    .logo { width: 40mm; } .qr { width: 30mm; margin-top: 2mm; }
  </style></head><body>${rows.join("")}</body></html>`;
}

/** Opens the system print dialog. It can't report whether paper came out, only that the dialog opened. */
export async function printViaBrowser(payload: PrintPayload): Promise<void> {
  const html = await receiptHtml(payload.document, payload);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.title = "Receipt";
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    throw new Error("This browser wouldn't open the print dialog.");
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  await Promise.all(
    [...win.document.images].map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) resolve(null);
          else img.onload = img.onerror = () => resolve(null);
        }),
    ),
  );
  setTimeout(() => frame.remove(), 60_000);
  win.focus();
  win.print();
}

/** Sends to whichever printer this terminal is set up for. A job key lets the bridge refuse to print
 *  the same job twice if its first reply was lost. */
export async function deliver(payload: PrintPayload, jobKey: string | null): Promise<void> {
  switch (payload.settings.connection) {
    case "bridge_lan":
    case "bridge_usb":
      return sendViaBridge(payload, jobKey);
    case "webusb":
      return sendViaWebUsb(bytesOf(payload.escpos_base64));
    case "bluetooth":
      return sendViaBluetooth(bytesOf(payload.escpos_base64));
    default:
      return printViaBrowser(payload);
  }
}

export function jobKeyOf(jobId: number): string {
  return `job-${jobId}`;
}

interface QueuedReport {
  job_id: number;
  status: PrintJobStatus;
  error: string | null;
}

/** Worth trying again later: unreachable, signed out, or a server fault. Losing a "sent" report would
 *  leave a printed bill looking unprinted, so only a definite refusal is given up on. */
function worthRetrying(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 401 || err.status === 408 || err.status === 429 || err.status >= 500;
}

/** The paper outcome still gets recorded if PetroPro was unreachable when it happened. */
export async function reportJob(token: string, report: QueuedReport): Promise<void> {
  try {
    await api.reportPrintJob(token, report.job_id, report.status, report.error);
  } catch (err) {
    if (worthRetrying(err)) writeJson(REPORTS_KEY, [...readJson<QueuedReport[]>(REPORTS_KEY, []), report]);
  }
}

export async function flushPrintReports(token: string): Promise<void> {
  const reports = readJson<QueuedReport[]>(REPORTS_KEY, []);
  if (reports.length === 0) return;
  const left: QueuedReport[] = [];
  for (const report of reports) {
    try {
      await api.reportPrintJob(token, report.job_id, report.status, report.error);
    } catch (err) {
      if (worthRetrying(err)) left.push(report);
    }
  }
  writeJson(REPORTS_KEY, left);
}

/** Keeps a failed receipt on this device, so it can still be printed if PetroPro is unreachable too. */
export function rememberFailed(payload: PrintPayload): void {
  if (!payload.job) return;
  const others = readJson<PrintPayload[]>(FAILED_KEY, []).filter((p) => p.job?.id !== payload.job?.id);
  writeJson(FAILED_KEY, [payload, ...others].slice(0, MAX_FAILED));
}

export function forgetFailed(jobId: number): void {
  writeJson(FAILED_KEY, readJson<PrintPayload[]>(FAILED_KEY, []).filter((p) => p.job?.id !== jobId));
}

export function findFailedForBill(billNo: number): PrintPayload | null {
  return readJson<PrintPayload[]>(FAILED_KEY, []).find((p) => p.job?.bill_no === billNo) ?? null;
}
