"use client";

import { useEffect, useState } from "react";
import type { OilCompany, PrintPayload, PrintStation, PrinterConnection, ReceiptLogo, ReceiptSettings, TerminalPrinterSettings } from "@petropro/shared-types";
import { api, ApiError } from "@/lib/api";
import { checkBridge, deliver, getBridgeConfig, getTerminalId, saveBridgeConfig, type BridgeConfig } from "@/lib/printing";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";
import { Button } from "@/components/ui/Button";
import { ReceiptPreview } from "@/components/ReceiptPreview";
import { PRINT_SETTINGS_CHANGED } from "@/components/PrintStationRunner";

const CONNECTIONS: { value: PrinterConnection; label: string; hint: string }[] = [
  { value: "browser", label: "Browser print dialog", hint: "No setup. Works with any installed printer, but someone has to confirm the dialog, and it can't report failures." },
  { value: "bridge_lan", label: "LAN printer, through the print bridge", hint: "Silent printing to a network printer. The print bridge must run on this computer." },
  { value: "bridge_usb", label: "USB printer, through the print bridge", hint: "Silent printing to a printer installed on this computer. The print bridge must run here." },
  { value: "webusb", label: "USB printer, direct from Chrome or Edge", hint: "No bridge. Suits Android. On Windows the printer's driver usually has to be replaced first." },
  { value: "bluetooth", label: "Bluetooth printer", hint: "Chrome on Android or a computer. Works only with BLE printers. You pick the printer once each session." },
  {
    value: "station",
    label: "Counter printer (another computer prints it)",
    hint: "For tablets and phones. Bills are sent to the counter computer, which prints them on its own printer. That computer must be a print station with PetroPro open.",
  },
];
/** Connections that print without anyone at the screen, so a print station can use them. */
const UNATTENDED: PrinterConnection[] = ["bridge_usb", "bridge_lan", "webusb", "bluetooth"];

const inputClass = "w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm";
/** 203 dpi: what nearly every receipt printer draws at, so a logo made at this prints at its size. */
const DOTS_PER_MM = 8;
const LOGO_SIZES = [
  { mm: 25, label: "Small (2.5 cm)" },
  { mm: 30, label: "Medium (3 cm)" },
  { mm: 35, label: "Large (3.5 cm)" },
];
/** The same limits the API keeps: 1.5 cm, up to the 7.2 cm an 80 mm printer can draw across. */
const LOGO_MIN_MM = 15;
const LOGO_MAX_MM = 72;
/** The square border round a company logo: 4 dots is half a millimetre, then a 1 mm gap to the logo. */
const FRAME_DOTS = 4;
const FRAME_GAP_DOTS = 8;

const OIL_COMPANIES: { value: OilCompany; label: string }[] = [
  { value: "iocl", label: "Indian Oil (IOCL)" },
  { value: "hpcl", label: "Hindustan Petroleum (HPCL)" },
  { value: "bpcl", label: "Bharat Petroleum (BPCL)" },
];

/** Company artwork ships with the web app in public/brand-logos, named by company code. */
async function loadCompanyLogo(company: OilCompany, widthMm: number): Promise<ReceiptLogo> {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const res = await fetch(`/brand-logos/${company}.${ext}`, { cache: "no-cache" }).catch(() => null);
    if (res?.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) {
      return imageToLogo(await res.blob(), widthMm, true);
    }
  }
  const label = OIL_COMPANIES.find((c) => c.value === company)?.label ?? company;
  throw new Error(`The ${label} logo isn't installed yet. It goes in apps/web/public/brand-logos as ${company}.png`);
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/**
 * Turns a picture into the one-bit image a thermal printer draws, in this browser. Dark colours print
 * solid and light ones drop out. On the company logos that keeps the navy, blue and red and loses the
 * orange and yellow, which looks like each company's own one-colour artwork. Shading (dithering) was
 * tried and turned Bharat Petroleum's blue-on-yellow into an unreadable grey.
 */
function imageToLogo(file: Blob, widthMm: number, framed = false): Promise<ReceiptLogo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be read as a picture"));
    };
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.width || !img.height) return reject(new Error("That picture has no size"));
      // The chosen size, to the nearest whole byte of dots, as ESC/POS draws rows a byte at a time.
      const width = Math.max(8, Math.round((widthMm * DOTS_PER_MM) / 8) * 8);
      // A framed logo is a square, with the picture fitted inside it.
      const height = framed ? width : Math.min(LOGO_MAX_MM * DOTS_PER_MM, Math.max(1, Math.round((img.height / img.width) * width)));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("This browser can't process pictures"));
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      if (framed) {
        const inset = FRAME_DOTS + FRAME_GAP_DOTS;
        const fit = Math.min((width - 2 * inset) / img.width, (height - 2 * inset) / img.height);
        const w = img.width * fit;
        const h = img.height * fit;
        ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, FRAME_DOTS);
        ctx.fillRect(0, height - FRAME_DOTS, width, FRAME_DOTS);
        ctx.fillRect(0, 0, FRAME_DOTS, height);
        ctx.fillRect(width - FRAME_DOTS, 0, FRAME_DOTS, height);
      } else {
        ctx.drawImage(img, 0, 0, width, height);
      }
      const image = ctx.getImageData(0, 0, width, height);
      const raster = new Uint8Array((width / 8) * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const at = (y * width + x) * 4;
          const dark = 0.299 * image.data[at] + 0.587 * image.data[at + 1] + 0.114 * image.data[at + 2] < 128;
          image.data[at] = image.data[at + 1] = image.data[at + 2] = dark ? 0 : 255;
          if (dark) raster[y * (width / 8) + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
      ctx.putImageData(image, 0, 0);
      resolve({ width, height, raster_base64: btoa(String.fromCharCode(...raster)), preview_data_url: canvas.toDataURL("image/png") });
    };
    img.src = url;
  });
}

export default function PrinterSettingsPage() {
  const session = useRequireSession(["super_admin", "owner"]);
  const [terminalId] = useState(() => (typeof window === "undefined" ? "" : getTerminalId()));
  const [terminal, setTerminal] = useState<TerminalPrinterSettings | null>(null);
  const [receipt, setReceipt] = useState<ReceiptSettings | null>(null);
  const [bridge, setBridge] = useState<BridgeConfig>(() => (typeof window === "undefined" ? { url: "", token: "" } : getBridgeConfig()));
  const [others, setOthers] = useState<{ terminal_id: string; settings: TerminalPrinterSettings; updated_at: string }[]>([]);
  const [windowsPrinters, setWindowsPrinters] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<PrintPayload | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [logoMessage, setLogoMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // The picture uploaded on this visit, kept so a size change can redraw it. Only the printer's
  // black-and-white version is saved, which would blur if it were scaled again.
  const [uploaded, setUploaded] = useState<File | null>(null);
  const [customSize, setCustomSize] = useState<string | null>(null);
  const [stations, setStations] = useState<PrintStation[]>([]);

  const token = session?.token;

  useEffect(() => {
    if (!token) return;
    api.getTerminalPrinter(token, terminalId).then(setTerminal, (err) => setMessage({ ok: false, text: messageOf(err, "Printer settings couldn't be loaded") }));
    api.getReceiptSettings(token).then(setReceipt, () => undefined);
    api.listPrintTerminals(token).then(setOthers, () => undefined);
    api.listPrintStations(token).then(setStations, () => undefined);
  }, [terminalId, token]);

  // A paired bridge lists this computer's printers straight away, so a printer renamed in Windows
  // shows up as missing here rather than as an error at the counter. Quietly does nothing unpaired.
  const pairedUsb = terminal?.connection === "bridge_usb" && Boolean(bridge.token);
  useEffect(() => {
    if (!pairedUsb) return;
    checkBridge().then((r) => setWindowsPrinters(r.printers), () => undefined);
  }, [pairedUsb]);

  if (!session || !token) return null;
  if (!terminal || !receipt) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 text-sm text-fg-muted">
        {message ? <p className="text-error">{message.text}</p> : "Loading..."}
      </div>
    );
  }

  const set = <K extends keyof TerminalPrinterSettings>(key: K, value: TerminalPrinterSettings[K]) => setTerminal({ ...terminal, [key]: value });
  const setR = <K extends keyof ReceiptSettings>(key: K, value: ReceiptSettings[K]) => setReceipt({ ...receipt, [key]: value });
  const usesBridge = terminal.connection === "bridge_lan" || terminal.connection === "bridge_usb";
  const toStation = terminal.connection === "station";
  const otherStations = stations.filter((st) => st.terminal_id !== terminalId);
  const hint = CONNECTIONS.find((c) => c.value === terminal.connection)?.hint;

  function choosePaper(mm: 58 | 80) {
    setTerminal({ ...terminal!, paper_mm: mm, printable_mm: mm === 80 ? 72 : 48, chars_per_line: mm === 80 ? 48 : 32 });
  }

  async function saveAll() {
    if (terminal!.print_station && !terminal!.terminal_name.trim()) {
      setMessage({ ok: false, text: "Give this terminal a name, such as Counter 1, so tablets can choose it as their printer." });
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      saveBridgeConfig(bridge);
      setTerminal(await api.saveTerminalPrinter(token!, terminalId, terminal!));
      setReceipt(await api.saveReceiptSettings(token!, receipt!));
      setOthers(await api.listPrintTerminals(token!));
      setStations(await api.listPrintStations(token!).catch(() => stations));
      window.dispatchEvent(new Event(PRINT_SETTINGS_CHANGED));
      setMessage({ ok: true, text: terminal!.print_station ? "Saved. This computer now prints bills sent from other devices while PetroPro is open." : "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: messageOf(err, "Save failed") });
    } finally {
      setWorking(false);
    }
  }

  async function testBridge() {
    setMessage(null);
    saveBridgeConfig(bridge);
    try {
      const result = await checkBridge();
      setWindowsPrinters(result.printers);
      setMessage({ ok: true, text: `Print bridge ${result.version} is connected.` });
    } catch (err) {
      setMessage({ ok: false, text: messageOf(err, "The bridge didn't answer") });
    }
  }

  /** A tablet's test page goes to its counter printer, and this waits to hear how it went. */
  async function testStation() {
    const station = stations.find((s) => s.terminal_id === terminal!.station_id);
    if (!station) {
      setMessage({ ok: false, text: "Choose the counter printer first." });
      return;
    }
    setWorking(true);
    setMessage({ ok: true, text: `Test page sent to ${station.name}. Waiting for it to print...` });
    try {
      const sent = await api.sendStationTest(token!, station.terminal_id);
      for (let waited = 0; waited < 30_000; waited += 1500) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const now = await api.getStationTest(token!, sent.id);
        if (now.status === "sent") return setMessage({ ok: true, text: `${station.name} printed the test page. Check the paper there.` });
        if (now.status === "failed") return setMessage({ ok: false, text: `${station.name} couldn't print it: ${now.error ?? "no reason given"}` });
      }
      setMessage({ ok: false, text: `${station.name} hasn't picked it up. Check that PetroPro is open on that computer. It will print as soon as it is.` });
    } catch (err) {
      setMessage({ ok: false, text: messageOf(err, "The test page couldn't be sent") });
    } finally {
      setWorking(false);
    }
  }

  async function testPrint() {
    if (terminal!.connection === "station") return testStation();
    setWorking(true);
    setMessage(null);
    saveBridgeConfig(bridge);
    try {
      const payload = await api.testPrint(token!, terminal!);
      setTestResult(payload);
      await deliver(payload, null);
      setMessage({ ok: true, text: terminal!.connection === "browser" ? "Test page sent to the print dialog." : "Test page sent to the printer. Check the paper." });
    } catch (err) {
      setMessage({ ok: false, text: messageOf(err, "The test page didn't print") });
    } finally {
      setWorking(false);
    }
  }

  async function chooseLogo(file: File | undefined) {
    if (!file) return;
    try {
      const logo = await imageToLogo(file, receipt!.logo_width_mm);
      setUploaded(file);
      setReceipt((r) => r && { ...r, logo, oil_company: null });
      setLogoMessage({ ok: true, text: "Logo ready. Save to keep it." });
    } catch (err) {
      setLogoMessage({ ok: false, text: messageOf(err, "That picture couldn't be used") });
    }
  }

  /** A new size redraws the logo from its original picture: the company's artwork, or the file
   *  uploaded on this visit. A logo uploaded on an earlier visit has to be uploaded again. */
  async function chooseSize(mm: number) {
    setLogoMessage(null);
    if (!Number.isFinite(mm) || mm < LOGO_MIN_MM || mm > LOGO_MAX_MM) {
      setLogoMessage({ ok: false, text: `Choose a size from ${LOGO_MIN_MM / 10} to ${LOGO_MAX_MM / 10} cm` });
      return;
    }
    const widthMm = Math.round(mm * 10) / 10;
    setReceipt((r) => r && { ...r, logo_width_mm: widthMm });
    try {
      let logo: ReceiptLogo | null = null;
      if (receipt!.oil_company) logo = await loadCompanyLogo(receipt!.oil_company, widthMm);
      else if (uploaded) logo = await imageToLogo(uploaded, widthMm);
      if (logo) {
        setReceipt((r) => r && { ...r, logo });
        setLogoMessage({ ok: true, text: `Logo resized to ${widthMm / 10} cm. Save to keep it.` });
      } else if (receipt!.logo) {
        setLogoMessage({ ok: false, text: "Upload the logo again to print it at this size." });
      }
    } catch (err) {
      setLogoMessage({ ok: false, text: messageOf(err, "The logo couldn't be resized") });
    }
  }

  /** Picking a company swaps in its logo and turns logo printing on for this terminal; picking none
   *  removes a company logo but leaves an uploaded one alone. Nothing is kept until Save. */
  async function chooseCompany(value: string) {
    setLogoMessage(null);
    if (!value) {
      setReceipt((r) => r && { ...r, oil_company: null, logo: r.oil_company ? null : r.logo });
      return;
    }
    const company = value as OilCompany;
    try {
      const logo = await loadCompanyLogo(company, receipt!.logo_width_mm);
      setReceipt((r) => r && { ...r, oil_company: company, logo });
      setTerminal((t) => t && { ...t, show_logo: true });
      setLogoMessage({ ok: true, text: "Logo ready, and Print logo is on for this computer. Save to keep it." });
    } catch (err) {
      setLogoMessage({ ok: false, text: messageOf(err, "That logo couldn't be loaded") });
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-xl font-semibold text-primary">Printer Settings</h1>
          <p className="text-sm text-fg-muted">The top section applies to this computer or phone only. Receipt content applies to every terminal.</p>
        </div>

        <Card color="teal" className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">This terminal</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Terminal name" htmlFor="terminal-name">
              <input id="terminal-name" className={inputClass} placeholder="e.g. Counter 1" value={terminal.terminal_name} onChange={(e) => set("terminal_name", e.target.value)} />
            </Field>
            <Field label="Default printer" htmlFor="printer-name">
              <input id="printer-name" className={inputClass} placeholder="e.g. Counter printer" value={terminal.printer_name} onChange={(e) => set("printer_name", e.target.value)} />
            </Field>
            <Field label="Printer model" htmlFor="printer-model">
              <input id="printer-model" className={inputClass} placeholder="e.g. Epson TM-T82" value={terminal.printer_model} onChange={(e) => set("printer_model", e.target.value)} />
            </Field>
            <Field label="Connection type" htmlFor="connection" hint={hint}>
              <select id="connection" className={inputClass} value={terminal.connection} onChange={(e) => set("connection", e.target.value as PrinterConnection)}>
                {CONNECTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>

            {toStation && (
              <Field
                label="Counter printer"
                htmlFor="station"
                hint={
                  otherStations.length === 0
                    ? "No computer is a print station yet. On the counter computer, open Printer Settings and turn on Print station."
                    : "Green means PetroPro is open there and listening."
                }
              >
                <select id="station" className={inputClass} value={terminal.station_id} onChange={(e) => set("station_id", e.target.value)}>
                  <option value="">Choose a counter printer</option>
                  {otherStations.map((st) => (
                    <option key={st.terminal_id} value={st.terminal_id}>
                      {st.online ? "🟢" : "⚪"} {st.name}
                      {st.online ? "" : " (not open right now)"}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {terminal.connection === "bridge_lan" && (
              <>
                <Field label="IP address" htmlFor="printer-host">
                  <input id="printer-host" className={inputClass} placeholder="192.168.1.50" value={terminal.host} onChange={(e) => set("host", e.target.value)} />
                </Field>
                <Field label="Port" htmlFor="printer-port" hint="Most printers use 9100.">
                  <input id="printer-port" type="number" className={inputClass} value={terminal.port} onChange={(e) => set("port", Number(e.target.value))} />
                </Field>
              </>
            )}
            {terminal.connection === "bridge_usb" && (
              <Field
                label="Printer on this computer"
                htmlFor="windows-printer"
                hint={windowsPrinters.length > 0 ? "The printers Windows has on this computer." : "Click Check connection to list this computer's printers, or type a path such as /dev/usb/lp0 on Linux."}
              >
                {windowsPrinters.length > 0 ? (
                  <select id="windows-printer" className={inputClass} value={terminal.windows_printer} onChange={(e) => set("windows_printer", e.target.value)}>
                    {!windowsPrinters.includes(terminal.windows_printer) && (
                      <option value={terminal.windows_printer}>{terminal.windows_printer ? `${terminal.windows_printer} (not on this computer)` : "Choose a printer"}</option>
                    )}
                    {windowsPrinters.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input id="windows-printer" className={inputClass} value={terminal.windows_printer} onChange={(e) => set("windows_printer", e.target.value)} />
                )}
                {windowsPrinters.length > 0 && terminal.windows_printer && !windowsPrinters.includes(terminal.windows_printer) && (
                  <p role="alert" className="mt-1 text-sm text-error">
                    Windows has no printer called &quot;{terminal.windows_printer}&quot; now. It may have been renamed. Choose it again from this list, then Save.
                  </p>
                )}
              </Field>
            )}

            {!toStation && (
              <>
            <Field label="Paper width" htmlFor="paper">
              <select id="paper" className={inputClass} value={terminal.paper_mm} onChange={(e) => choosePaper(Number(e.target.value) as 58 | 80)}>
                <option value={80}>80 mm (3 inch)</option>
                <option value={58}>58 mm (2 inch)</option>
              </select>
            </Field>
            <Field label="Printable width (mm)" htmlFor="printable" hint="Usually 72 mm on 80 mm paper. Check your printer's specification.">
              <input id="printable" type="number" className={inputClass} value={terminal.printable_mm} onChange={(e) => set("printable_mm", Number(e.target.value))} />
            </Field>
            <Field label="Characters per line" htmlFor="chars" hint="48 or 42 on 80 mm, 32 on 58 mm. If lines wrap on paper, lower this.">
              <input id="chars" type="number" className={inputClass} value={terminal.chars_per_line} onChange={(e) => set("chars_per_line", Number(e.target.value))} />
            </Field>
            <Field label="Character encoding" htmlFor="encoding">
              <select id="encoding" className={inputClass} value={terminal.encoding} onChange={(e) => set("encoding", e.target.value as TerminalPrinterSettings["encoding"])}>
                <option value="cp437">CP437 (most printers)</option>
                <option value="cp858">CP858 (Western, with euro sign)</option>
                <option value="ascii">Plain ASCII</option>
              </select>
            </Field>
            <Field label="Receipt copies" htmlFor="copies" hint="For the first print. A reprint is always one copy.">
              <input id="copies" type="number" min={1} max={5} className={inputClass} value={terminal.copies} onChange={(e) => set("copies", Number(e.target.value))} />
            </Field>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Toggle id="auto-print" label="Auto-print after finalizing a bill" checked={terminal.auto_print} onChange={(v) => set("auto_print", v)} />
            {!toStation && (
              <>
                <Toggle id="auto-cut" label="Auto-cut" checked={terminal.auto_cut} onChange={(v) => set("auto_cut", v)} />
                <Toggle id="show-logo" label="Print logo" checked={terminal.show_logo} onChange={(v) => set("show_logo", v)} />
                <Toggle id="show-qr" label="Print QR code" checked={terminal.show_qr} onChange={(v) => set("show_qr", v)} />
              </>
            )}
          </div>
          {toStation && (
            <p className="text-sm text-fg-muted">Paper, logo and cutting come from the counter printer&apos;s own settings.</p>
          )}

          {UNATTENDED.includes(terminal.connection) && (
            <div className="rounded-lg border border-border p-3">
              <Toggle
                id="print-station"
                label="Print station: also print bills sent from tablets and phones"
                checked={terminal.print_station}
                onChange={(v) => set("print_station", v)}
              />
              <p className="mt-1 text-xs text-fg-muted">
                Keep PetroPro open on this computer while the outlet is open: it prints whatever other devices send here. Tablets choose it by its
                Terminal name.
              </p>
            </div>
          )}

          {usesBridge && (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-border p-3 md:grid-cols-2">
              <Field label="Print bridge address" htmlFor="bridge-url">
                <input id="bridge-url" className={inputClass} value={bridge.url} onChange={(e) => setBridge({ ...bridge, url: e.target.value })} />
              </Field>
              <Field label="Pairing token" htmlFor="bridge-token" hint="Shown when the bridge starts. It's stored on this device only, never on the server.">
                <input id="bridge-token" name="bridge-token" type="password" autoComplete="new-password" spellCheck={false} data-1p-ignore data-lpignore="true" className={inputClass} value={bridge.token} onChange={(e) => setBridge({ ...bridge, token: e.target.value })} />
              </Field>
              <div>
                <Button size="sm" variant="outline" onClick={testBridge}>
                  Check connection
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveAll} disabled={working}>
              {working ? "Working..." : "Save"}
            </Button>
            <Button variant="outline" onClick={testPrint} disabled={working}>
              Test Print
            </Button>
          </div>
          {message && (
            <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-success" : "text-error"}`}>
              {message.text}
            </p>
          )}
          {testResult && <ReceiptPreview payload={testResult} />}
        </Card>

        <Card color="teal" className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">Receipt content</h2>
            <p className="text-sm text-fg-muted">The bunk&apos;s name, address and GSTIN come from Settings. Remember to save.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Contact and statutory lines" htmlFor="header-lines" hint="One per line, printed under the address. Up to 8.">
              <textarea
                id="header-lines"
                rows={4}
                className={inputClass}
                value={receipt.header_lines.join("\n")}
                onChange={(e) => setR("header_lines", e.target.value.split("\n"))}
              />
            </Field>
            <div className="flex flex-col gap-4">
              <Field label="Thank-you message" htmlFor="footer">
                <input id="footer" className={inputClass} value={receipt.footer_text} onChange={(e) => setR("footer_text", e.target.value)} />
              </Field>
              <Field label="Quantity decimals" htmlFor="qty-decimals" hint="Petbill prints 2.">
                <select id="qty-decimals" className={inputClass} value={receipt.qty_decimals} onChange={(e) => setR("qty_decimals", Number(e.target.value))}>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </Field>
              <Field label="QR link stays valid for (days)" htmlFor="qr-days" hint="The QR opens the bill for whoever holds the receipt.">
                <input id="qr-days" type="number" min={1} max={90} className={inputClass} value={receipt.qr_link_days} onChange={(e) => setR("qr_link_days", Number(e.target.value))} />
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Toggle id="r-gstin" label="GSTIN" checked={receipt.show_gstin} onChange={(v) => setR("show_gstin", v)} />
            <Toggle id="r-tagline" label="Tagline" checked={receipt.show_tagline} onChange={(v) => setR("show_tagline", v)} />
            <Toggle id="r-customer" label="Customer on credit bills" checked={receipt.show_customer} onChange={(v) => setR("show_customer", v)} />
            <Toggle id="r-vehicle" label="Vehicle" checked={receipt.show_vehicle} onChange={(v) => setR("show_vehicle", v)} />
            <Toggle id="r-cashier" label="Cashier" checked={receipt.show_cashier} onChange={(v) => setR("show_cashier", v)} />
            <Toggle id="r-mileage" label="Mileage" checked={receipt.show_mileage} onChange={(v) => setR("show_mileage", v)} />
            <Toggle id="r-tax" label="Tax details" checked={receipt.show_tax_breakup} onChange={(v) => setR("show_tax_breakup", v)} />
            <Toggle id="r-fest" label="New Year and Pongal greetings" checked={receipt.festival_greetings} onChange={(v) => setR("festival_greetings", v)} />
          </div>
          <Field label="Oil company" htmlFor="oil-company" hint="Prints that company's logo, centred at the top of every bill.">
            <select id="oil-company" className={`${inputClass} md:max-w-sm`} value={receipt.oil_company ?? ""} onChange={(e) => chooseCompany(e.target.value)}>
              <option value="">None, or my own logo</option>
              {OIL_COMPANIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Logo size"
            htmlFor="logo-size"
            hint={`Width on the paper. The logo now on file prints ${receipt.logo ? `${receipt.logo.width / DOTS_PER_MM / 10} cm` : "—"} wide. A 58 mm printer fits up to 4.8 cm.`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="logo-size"
                className={`${inputClass} md:max-w-xs`}
                value={customSize !== null || !LOGO_SIZES.some((s) => s.mm === receipt.logo_width_mm) ? "custom" : String(receipt.logo_width_mm)}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    setCustomSize(String(receipt.logo_width_mm / 10));
                  } else {
                    setCustomSize(null);
                    void chooseSize(Number(e.target.value));
                  }
                }}
              >
                {LOGO_SIZES.map((s) => (
                  <option key={s.mm} value={s.mm}>
                    {s.label}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {(customSize !== null || !LOGO_SIZES.some((s) => s.mm === receipt.logo_width_mm)) && (
                <>
                  <input
                    aria-label="Custom logo width in centimetres"
                    type="number"
                    min={LOGO_MIN_MM / 10}
                    max={LOGO_MAX_MM / 10}
                    step={0.1}
                    className={`${inputClass} w-24`}
                    value={customSize ?? String(receipt.logo_width_mm / 10)}
                    onChange={(e) => setCustomSize(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void chooseSize(Number(customSize) * 10);
                    }}
                  />
                  <span className="text-sm">cm</span>
                  <Button size="sm" variant="outline" onClick={() => chooseSize(Number(customSize ?? receipt.logo_width_mm / 10) * 10)}>
                    Apply
                  </Button>
                </>
              )}
            </div>
          </Field>
          <div>
            <label htmlFor="logo-file" className="mb-1 block text-sm font-medium">
              {receipt.oil_company ? "Logo" : "Logo (or upload your own)"}
            </label>
            {receipt.logo && (
              // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL, not an optimizable remote image
              <img src={receipt.logo.preview_data_url} alt="Receipt logo" className="mb-2 max-h-32 rounded bg-white p-1" />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input id="logo-file" type="file" accept="image/*" className="max-w-full text-sm" onChange={(e) => chooseLogo(e.target.files?.[0])} />
              {receipt.logo && (
                <Button size="sm" variant="outline" onClick={() => setReceipt({ ...receipt, logo: null, oil_company: null })}>
                  Remove logo
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-fg-muted">Converted to black and white, as the printer will draw it. Turn on &quot;Print logo&quot; for each terminal that should print it.</p>
            {receipt.logo && !terminal.show_logo && (
              <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-error">
                <span>Print logo is off for this computer, so its bills print without the logo.</span>
                <Button size="sm" variant="outline" onClick={() => set("show_logo", true)}>
                  Turn it on
                </Button>
              </div>
            )}
            {logoMessage && (
              <p role={logoMessage.ok ? "status" : "alert"} className={`mt-1 text-sm ${logoMessage.ok ? "text-success" : "text-error"}`}>
                {logoMessage.text}
              </p>
            )}
          </div>
          <div>
            <Button onClick={saveAll} disabled={working}>
              {working ? "Working..." : "Save"}
            </Button>
          </div>
        </Card>

        {others.length > 0 && (
          <Card color="teal" className="overflow-x-auto">
            <h2 className="mb-2 text-lg font-semibold">Terminals</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4">Terminal</th>
                  <th className="py-2 pr-4">Printer</th>
                  <th className="py-2 pr-4">Connection</th>
                  <th className="py-2 pr-4">Paper</th>
                  <th className="py-2 pr-4">Auto-print</th>
                  <th className="py-2 pr-4">Updated</th>
                </tr>
              </thead>
              <tbody>
                {others.map((t) => (
                  <tr key={t.terminal_id} className="border-b border-border">
                    <td className="py-2 pr-4">
                      {t.settings.terminal_name || "Unnamed"}
                      {t.terminal_id === terminalId && <span className="ml-2 text-xs text-success">this one</span>}
                    </td>
                    <td className="py-2 pr-4">{t.settings.printer_name || t.settings.printer_model || "—"}</td>
                    <td className="py-2 pr-4">{CONNECTIONS.find((c) => c.value === t.settings.connection)?.label ?? t.settings.connection}</td>
                    <td className="py-2 pr-4">{t.settings.paper_mm} mm</td>
                    <td className="py-2 pr-4">{t.settings.auto_print ? "Yes" : "No"}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-fg-muted">{t.updated_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
