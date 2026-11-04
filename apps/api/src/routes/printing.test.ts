import test from "node:test";
import assert from "node:assert/strict";
import type { PrintJob, PrintPayload, ReceiptDocument, TerminalPrinterSettings } from "@petropro/shared-types";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const { createSession } = await import("../services/sessions.js");
const { requestPrint } = await import("../services/printing.js");
const { encodeText, renderEscPos } = await import("../services/escpos.js");
const { wrapText, renderText } = await import("../services/receipt.js");
const { DEFAULT_TERMINAL_SETTINGS, DEFAULT_RECEIPT_SETTINGS } = await import("../repositories/printing.js");

db.exec(`
  INSERT INTO users (user_id, name, password_hash, role) VALUES
    ('boss', 'Boss', 'x', 'super_admin'), ('own', 'Owner', 'x', 'owner'), ('kp', 'R KUMAR', 'x', 'operator'), ('pump', 'Pump', 'x', 'field_operator');
  INSERT INTO items (code, name) VALUES ('A01', 'DIESEL'), ('B01', 'PETROL'), ('D01', '20LTS DEF'),
    ('L01', 'A VERY LONG LUBRICANT PRODUCT NAME THAT WILL NOT FIT');
  INSERT INTO customers (code, name, print_name, due_amount) VALUES ('C01', 'A Fleet Company Private Limited', 'FLEET-1', 500), ('C02', 'No Print Name Ltd', NULL, 0);
  INSERT INTO vehicles (vehicle_no) VALUES ('TN01AB1234');
  UPDATE tenants SET name = 'Sample Fuels', address_line1 = '12 Main Road', address_line2 = 'Chennai', gst_no = '33AAAAA0000A1Z5', tagline = 'Dealers of Fuel' WHERE id = 1;
`);

const app = await buildApp();
app.log.level = "silent";
test.after(() => app.close());

const token = (user_id: string, role: string) =>
  app.signAccessToken({ user_id, role: role as never, name: user_id }, createSession(user_id, "password", undefined).sessionId);
const superToken = token("boss", "super_admin");
const ownerToken = token("own", "owner");
const cashierToken = token("kp", "operator");
const pumpToken = token("pump", "field_operator");
const TERMINAL = "terminal-aaaa-1111";
const TERMINAL_2 = "terminal-bbbb-2222";

const call = (method: "GET" | "PUT" | "POST" | "PATCH", url: string, payload?: unknown, bearer: string = cashierToken) =>
  app.inject({ method, url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, payload: payload as never });

let keyCounter = 0;
const newKey = () => `key-${++keyCounter}-abcdefgh`;
const print = async (billNo: number, requestKey = newKey(), terminal_id = TERMINAL) => call("POST", `/bills/${billNo}/print-jobs`, { request_key: requestKey, terminal_id });

function makeBill(options: {
  payment?: string;
  customer?: string | null;
  vehicle?: string | null;
  order?: string | null;
  date?: string;
  lines?: [item: string, qty: number, rate: number, base: number, taxPer: number, tax: number, amount: number][];
} = {}): number {
  const lines = options.lines ?? [["A01", 10, 90, 90, 0, 0, 900]];
  const total = lines.reduce((s, l) => s + l[6], 0);
  const tax = lines.reduce((s, l) => s + l[5], 0);
  const bill = db
    .prepare(
      `INSERT INTO bills (bill_date, vehicle_no, customer_code, user_id, sub_total, tax_total, grand_total, payment_type, order_no)
       VALUES (?, ?, ?, 'kp', ?, ?, ?, ?, ?)`,
    )
    .run(options.date ?? "2026-06-13 22:20:25", options.vehicle === undefined ? "TN01AB1234" : options.vehicle, options.customer ?? null, total - tax, tax, total, options.payment ?? "cash", options.order ?? null);
  const billNo = Number(bill.lastInsertRowid);
  for (const [item, qty, rate, base, taxPer, lineTax, amount] of lines) {
    db.prepare(
      "INSERT INTO bill_lines (bill_no, item_code, qty, rate, rate_pretax, amount, tax_percent, tax_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(billNo, item, qty, rate, base, amount, taxPer, lineTax);
  }
  return billNo;
}

const snapshot = () =>
  JSON.stringify([
    db.prepare("SELECT count(*) n, sum(grand_total) t FROM bills").get(),
    db.prepare("SELECT count(*) n, sum(amount) t FROM bill_lines").get(),
    db.prepare("SELECT * FROM stock_daybook ORDER BY item_code, sdate").all(),
    db.prepare("SELECT code, due_amount FROM customers ORDER BY code").all(),
  ]);

function terminal(overrides: Partial<TerminalPrinterSettings> = {}): TerminalPrinterSettings {
  return { ...DEFAULT_TERMINAL_SETTINGS, ...overrides };
}

const printableBytes = (buf: Buffer) => buf.toString("latin1");

test("printing is for staff, and settings are for admins", async () => {
  const billNo = makeBill();
  for (const [method, url] of [
    ["GET", "/print/settings"],
    ["GET", `/bills/${billNo}/receipt`],
    ["GET", `/bills/${billNo}/receipt.pdf`],
    ["POST", `/bills/${billNo}/print-jobs`],
    ["GET", "/print-jobs/unfinished"],
  ] as const) {
    assert.equal((await call(method, url, undefined, "")).statusCode, 401, url);
    const invoiceToken = app.jwt.sign({ sub: String(billNo), role: "invoice" });
    assert.equal((await call(method, url, {}, invoiceToken)).statusCode, 403, `${url} with a QR-link token`);
  }
  for (const [method, url] of [
    ["PUT", "/print/settings"],
    ["PUT", `/print/terminals/${TERMINAL}`],
    ["POST", "/print/test"],
    ["GET", "/print/terminals"],
  ] as const) {
    assert.equal((await call(method, url, {}, cashierToken)).statusCode, 403, `${url} as a cashier`);
    assert.equal((await call(method, url, {}, ownerToken)).statusCode, 200, `${url} as an owner`);
  }
  assert.equal((await call("GET", `/bills/${billNo}/receipt`, undefined, pumpToken)).statusCode, 200);
});

test("the receipt shows the same figures as a real Petbill receipt", async () => {
  // From legacy X.TXT, Petbill's test-mode output, with the customer and vehicle replaced.
  const billNo = makeBill({
    payment: "credit",
    customer: "C01",
    order: "7",
    date: "2019-06-13 22:20:25",
    lines: [["D01", 1, 1000, 847.46, 18, 152.54, 1000]],
  });
  const res = await call("GET", `/bills/${billNo}/receipt?terminal_id=${TERMINAL}`);
  assert.equal(res.statusCode, 200, res.body);
  const { text } = res.json() as PrintPayload;
  assert.match(text, /CREDIT SALES\s+ORD NO\. 7/);
  assert.match(text, new RegExp(`Bill No\\. ${billNo}\\s+DT :13/06/2019`));
  assert.match(text, /Time :22:20:25/);
  assert.match(text, /20LTS DEF\s+1000\.00\s+1\.00\s+1000\.00/);
  assert.match(text, /847\.46\s+18\.00\s+152\.54/);
  assert.match(text, /Amount\s+847\.46/);
  assert.match(text, /Tax\.Amt\s+152\.54/);
  assert.match(text, /TOTAL Rs\.1000\.00/);
  assert.match(text, /FLEET-1/);
  assert.match(text, /VNO:TN01AB1234\s+Cashier:R KUMAR/);
  assert.match(text, /THANK YOU VISIT AGAIN/);
  assert.ok(text.indexOf("Sample Fuels") < text.indexOf("Bill No."), "the header comes first on a cut receipt");
});

test("the receipt's amount and tax add up to the total, from the stored bill", async () => {
  // Five litres at 96.72: Petbill's rate * qty would print 409.85 and not add up to 483.60.
  const billNo = makeBill({ lines: [["B01", 5, 96.72, 81.97, 18, 73.77, 483.6]] });
  const { text } = (await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload;
  assert.match(text, /Amount\s+409\.83/);
  assert.match(text, /Tax\.Amt\s+73\.77/);
  assert.match(text, /TOTAL Rs\.483\.60/);
  assert.match(text, /409\.83\s+18\.00\s+73\.77/, "the line's own row agrees");
  assert.doesNotMatch(text, /409\.85/);
});

test("an imported bill shows its Petbill number, and a PetroPro bill doesn't", async () => {
  const live = makeBill();
  assert.doesNotMatch(((await call("GET", `/bills/${live}/receipt`)).json() as PrintPayload).text, /Petbill/);
  const imported = makeBill();
  db.prepare("UPDATE bills SET legacy_bill_no = 3101 WHERE bill_no = ?").run(imported);
  const { text } = (await call("GET", `/bills/${imported}/receipt`)).json() as PrintPayload;
  assert.match(text, /Petbill Bill No\. 3101/);
  assert.match(text, new RegExp(`Bill No\\. ${imported}\\s`));
});

test("cash bills match the legacy rules: no customer, no order number", async () => {
  const billNo = makeBill({ payment: "cash" });
  const { text } = (await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload;
  assert.match(text, /CASH SALES/);
  assert.doesNotMatch(text, /ORD NO/);
  assert.doesNotMatch(text, /FLEET/);
  assert.doesNotMatch(text, /Vat%|Bas\.Amt|Tax\.Amt/, "no tax columns on an untaxed bill");
  assert.match(text, /DIESEL\s+90\.00\s+10\.00\s+900\.00/);
});

test("a bill mixing fuel and a taxed item shows one tax row, and Petbill's totals", async () => {
  // Real shape: legacy bill 3101 in JUNBIL19, with other figures for the fuel.
  const billNo = makeBill({ payment: "credit", customer: "C01", lines: [["A01", 262.01, 68.05, 68.05, 0, 0, 17829.78], ["D01", 1, 1000, 847.46, 18, 152.54, 1000]] });
  const { text } = (await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload;
  assert.match(text, /DIESEL\s+68\.05\s+262\.01\s+17829\.78/);
  assert.equal(text.split("\n").filter((l) => /^\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*$/.test(l)).length, 1, "only the taxed line has a tax row");
  assert.match(text, /Amount\s+18677\.24/);
  assert.match(text, /Tax\.Amt\s+152\.54/);
  assert.match(text, /TOTAL Rs\.18829\.78/);
});

test("the customer prints on credit bills only, as in Petbill", async () => {
  const billNo = makeBill({ payment: "cash", customer: "C01" });
  assert.doesNotMatch(((await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload).text, /FLEET-1/);
});

test("no line carries trailing spaces onto the paper", async () => {
  const { text } = (await call("GET", `/bills/${makeBill()}/receipt`)).json() as PrintPayload;
  for (const line of text.split("\n")) assert.equal(line, line.trimEnd());
});

test("a credit customer with no print name falls back to their name, in full", async () => {
  const billNo = makeBill({ payment: "credit", customer: "C02" });
  const { text } = (await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload;
  assert.match(text, /No Print Name Ltd/);
});

test("rounding and precision follow Petbill: two decimals by default, three if chosen", async () => {
  const billNo = makeBill({ lines: [["B01", 9.6674, 103.44, 103.44, 0, 0, 1000]] });
  assert.match(((await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload).text, /PETROL\s+103\.44\s+9\.67\s+1000\.00/);
  await call("PUT", "/print/settings", { qty_decimals: 3 }, superToken);
  assert.match(((await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload).text, /9\.667/);
  await call("PUT", "/print/settings", { qty_decimals: 2 }, superToken);
});

test("large amounts and long names are never cut, at 80 or 58 mm", async () => {
  const billNo = makeBill({
    payment: "credit",
    customer: "C01",
    lines: [
      ["L01", 12345.678, 1234567.89, 1000000, 18, 2345678.9, 15241578750.19],
      ["A01", 100000, 98.76, 98.76, 0, 0, 9876000],
    ],
  });
  for (const chars of [48, 42, 32]) {
    await call("PUT", `/print/terminals/${TERMINAL}`, { chars_per_line: chars }, superToken);
    const { text, document } = (await call("GET", `/bills/${billNo}/receipt?terminal_id=${TERMINAL}`)).json() as PrintPayload;
    for (const figure of ["1234567.89", "12345.68", "15241578750.19", "2345678.90", "9876000.00", "100000.00"]) {
      assert.ok(text.includes(figure), `${figure} at ${chars} characters`);
    }
    assert.ok(text.replace(/\s+/g, " ").includes("A VERY LONG LUBRICANT PRODUCT NAME THAT WILL NOT FIT"), `whole name at ${chars}`);
    for (const line of text.split("\n")) assert.ok(line.length <= chars, `"${line}" fits ${chars}`);
    for (const block of document.blocks) {
      if (block.kind === "text" && block.double) assert.ok(block.text.length * 2 <= chars, `double-width "${block.text}" fits ${chars}`);
    }
  }
  await call("PUT", `/print/terminals/${TERMINAL}`, { chars_per_line: 48 }, superToken);
});

test("missing optional details leave no blank lines or empty labels", async () => {
  db.exec("UPDATE tenants SET address_line1 = NULL, address_line2 = NULL, gst_no = NULL, tagline = NULL WHERE id = 1");
  const billNo = makeBill({ vehicle: null, date: "2026-06-13 00:00:00" });
  const { text } = (await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload;
  db.exec("UPDATE tenants SET address_line1 = '12 Main Road', address_line2 = 'Chennai', gst_no = '33AAAAA0000A1Z5', tagline = 'Dealers of Fuel' WHERE id = 1");
  assert.ok(!/\n\s*\n/.test(text), "no blank lines");
  assert.doesNotMatch(text, /VNO:|GSTIN|Time :/);
  assert.match(text, /Cashier:R KUMAR/);
});

test("every field can be switched off, and header lines and footer come from settings", async () => {
  const billNo = makeBill({ payment: "credit", customer: "C01", lines: [["D01", 1, 1000, 847.46, 18, 152.54, 1000]] });
  await call(
    "PUT",
    "/print/settings",
    { header_lines: ["Ph: 044-1234", "  ", "Lic No. 42"], footer_text: "COME AGAIN", show_gstin: false, show_tagline: false, show_customer: false, show_vehicle: false, show_cashier: false, show_tax_breakup: false },
    superToken,
  );
  const { text } = (await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload;
  await call("PUT", "/print/settings", { ...DEFAULT_RECEIPT_SETTINGS }, superToken);
  assert.match(text, /Ph: 044-1234/);
  assert.match(text, /Lic No\. 42/);
  assert.match(text, /COME AGAIN/);
  for (const hidden of [/GSTIN/, /Dealers of Fuel/, /FLEET-1/, /VNO:/, /Cashier/, /Vat%/, /152\.54/, /THANK YOU/]) assert.doesNotMatch(text, hidden);
  assert.match(text, /TOTAL Rs\.1000\.00/);
});

test("mileage prints as Petbill's does when the bill has it", async () => {
  const billNo = makeBill({ lines: [["A01", 10, 90, 90, 0, 0, 900]] });
  db.prepare("INSERT INTO mileage_log (bill_no, vehicle_no, item_code, odometer_prev, odometer_curr, qty, mileage) VALUES (?, 'TN01AB1234', 'A01', 1000, 1120.5, 10, 12.05)").run(billNo);
  const { text } = (await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload;
  assert.match(text, /MileAge :12\.05/);
  assert.match(text, /KMR : 1000\.0-1120\.5=120\.5/);
});

test("Petbill's festival greetings print on the first copy only", async () => {
  for (const [date, greeting] of [["2026-01-01 09:00:00", /HAPPY NEW YEAR/], ["2026-01-15 09:00:00", /HAPPY PONGAL/]] as const) {
    const billNo = makeBill({ date });
    const first = (await print(billNo)).json() as PrintPayload;
    assert.match(first.text, greeting);
    await call("PATCH", `/print-jobs/${first.job!.id}`, { status: "sent" });
    const dup = (await print(billNo)).json() as PrintPayload;
    assert.doesNotMatch(dup.text, greeting);
  }
  assert.doesNotMatch(((await call("GET", `/bills/${makeBill({ date: "2026-01-17 09:00:00" })}/receipt`)).json() as PrintPayload).text, /HAPPY/);
});

test("a cancelled bill says so", async () => {
  const billNo = makeBill();
  db.prepare("UPDATE bills SET status = 'cancelled' WHERE bill_no = ?").run(billNo);
  assert.match(((await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload).text, /\*\* CANCELLED \*\*/);
});

test("a preview creates nothing and changes nothing", async () => {
  const billNo = makeBill();
  const before = snapshot();
  const res = (await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload;
  assert.equal(res.job, null);
  assert.equal((db.prepare("SELECT count(*) n FROM print_jobs WHERE bill_no = ?").get(billNo) as { n: number }).n, 0);
  assert.equal(snapshot(), before);
});

test("the first print is the original, and a reprint is marked, audited and changes no sale", async () => {
  const billNo = makeBill({ payment: "credit", customer: "C01" });
  const before = snapshot();

  const first = (await print(billNo)).json() as PrintPayload;
  assert.equal(first.job!.kind, "original");
  assert.doesNotMatch(first.text, /DUPLICATE BILL/);
  assert.equal(first.job!.status, "pending");
  const sent = await call("PATCH", `/print-jobs/${first.job!.id}`, { status: "sent" });
  assert.equal((sent.json() as PrintJob).status, "sent");

  const audits = () => (db.prepare("SELECT count(*) n FROM audit_logs WHERE action = 'reprint_bill' AND entity_id = ?").get(String(billNo)) as { n: number }).n;
  assert.equal(audits(), 0, "the original isn't a reprint");

  const second = (await print(billNo)).json() as PrintPayload;
  assert.equal(second.job!.kind, "duplicate");
  assert.match(second.text, /DUPLICATE BILL/);
  assert.equal(second.job!.copies, 1);
  assert.ok(printableBytes(Buffer.from(second.escpos_base64, "base64")).includes("DUPLICATE BILL"));
  assert.equal(audits(), 1);
  const log = db.prepare("SELECT * FROM audit_logs WHERE action = 'reprint_bill' AND entity_id = ?").get(String(billNo)) as { user_id: string; details: string };
  assert.equal(log.user_id, "kp");
  assert.equal(JSON.parse(log.details).terminal, TERMINAL);

  assert.equal(snapshot(), before, "no sale, stock or due moved");
  assert.equal((await call("GET", `/bills/${billNo}/print-jobs`)).json().length, 2);
});

test("a preview after printing shows the duplicate banner", async () => {
  const billNo = makeBill();
  assert.doesNotMatch(((await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload).text, /DUPLICATE/);
  const job = ((await print(billNo)).json() as PrintPayload).job!;
  await call("PATCH", `/print-jobs/${job.id}`, { status: "sent" });
  assert.match(((await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload).text, /DUPLICATE/);
});

test("the same request twice is one job", async () => {
  const billNo = makeBill();
  const key = newKey();
  const a = (await print(billNo, key)).json() as PrintPayload;
  const b = (await print(billNo, key)).json() as PrintPayload;
  assert.equal(a.job!.id, b.job!.id);
  assert.equal((db.prepare("SELECT count(*) n FROM print_jobs WHERE bill_no = ?").get(billNo) as { n: number }).n, 1);
  // A key is tied to its bill.
  assert.equal((await print(makeBill(), key)).statusCode, 409);
});

test("two terminals can't both print the original", async () => {
  const billNo = makeBill();
  const first = await print(billNo, newKey(), TERMINAL);
  assert.equal(first.statusCode, 200);
  const second = await print(billNo, newKey(), TERMINAL_2);
  assert.equal(second.statusCode, 409);
  assert.match(second.json().error, /printing right now/);
  assert.equal((db.prepare("SELECT count(*) n FROM print_jobs WHERE bill_no = ?").get(billNo) as { n: number }).n, 1);
});

test("many terminals at once still give one original per bill", async () => {
  const billNo = makeBill();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => print(billNo, newKey(), `terminal-many-${i}0000`)));
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(results.filter((r) => r.statusCode === 409).length, 7);
  assert.equal((db.prepare("SELECT count(*) n FROM print_jobs WHERE bill_no = ? AND kind = 'original'").get(billNo) as { n: number }).n, 1);
});

test("a failed print leaves the bill alone, retries as the same job, and earns no duplicate banner", async () => {
  const billNo = makeBill({ payment: "credit", customer: "C01" });
  const before = snapshot();
  const job = ((await print(billNo)).json() as PrintPayload).job!;

  const failed = (await call("PATCH", `/print-jobs/${job.id}`, { status: "failed", error: "Printer refused the connection" })).json() as PrintJob;
  assert.equal(failed.status, "failed");
  assert.match(failed.error!, /refused/);
  assert.ok(((await call("GET", "/print-jobs/unfinished")).json() as PrintJob[]).some((j) => j.id === job.id));
  assert.equal(snapshot(), before);

  const retry = (await call("POST", `/print-jobs/${job.id}/retry`, { terminal_id: TERMINAL })).json() as PrintPayload;
  assert.equal(retry.job!.id, job.id);
  assert.equal(retry.job!.attempts, 2);
  assert.equal(retry.job!.kind, "original");
  assert.doesNotMatch(retry.text, /DUPLICATE/);

  // A new request while it's unprinted is still the original too, once it's not in progress.
  await call("PATCH", `/print-jobs/${job.id}`, { status: "failed", error: "again" });
  const again = (await print(billNo)).json() as PrintPayload;
  assert.equal(again.job!.id, job.id);
  assert.doesNotMatch(again.text, /DUPLICATE/);

  await call("PATCH", `/print-jobs/${job.id}`, { status: "sent" });
  const retryAfterSent = await call("POST", `/print-jobs/${job.id}/retry`, { terminal_id: TERMINAL });
  assert.equal(retryAfterSent.statusCode, 409);
  assert.match(retryAfterSent.json().error, /Reprint/);
  assert.ok(!((await call("GET", "/print-jobs/unfinished")).json() as PrintJob[]).some((j) => j.id === job.id));
  assert.equal(snapshot(), before);
});

test("a late failure report can't reopen a job that reached the printer", async () => {
  const job = ((await print(makeBill())).json() as PrintPayload).job!;
  await call("PATCH", `/print-jobs/${job.id}`, { status: "sent" });
  assert.equal(((await call("PATCH", `/print-jobs/${job.id}`, { status: "failed", error: "late" })).json() as PrintJob).status, "sent");
  assert.equal((await call("PATCH", `/print-jobs/${job.id}`, { status: "pending" })).statusCode, 400);
});

test("a terminal that crashed mid-print can't block a bill forever", () => {
  const billNo = makeBill();
  const base = { billNo, terminalId: TERMINAL, userId: "kp", mintQrUrl: () => "" };
  const now = Date.now();
  const first = requestPrint({ ...base, requestKey: newKey(), now });
  assert.throws(() => requestPrint({ ...base, requestKey: newKey(), now: now + 30_000 }), /printing right now/);
  const later = requestPrint({ ...base, requestKey: newKey(), now: now + 120_000 });
  assert.equal(later.job!.id, first.job!.id);
  assert.equal(later.job!.kind, "original");
});

test("a double-clicked reprint prints once", () => {
  const billNo = makeBill();
  const base = { billNo, terminalId: TERMINAL, userId: "kp", mintQrUrl: () => "" };
  const now = Date.now();
  const original = requestPrint({ ...base, requestKey: newKey(), now });
  db.prepare("UPDATE print_jobs SET status = 'sent' WHERE id = ?").run(original.job!.id);
  requestPrint({ ...base, requestKey: newKey(), now });
  assert.throws(() => requestPrint({ ...base, requestKey: newKey(), now: now + 3000 }), /reprinted a moment ago/);
  const later = requestPrint({ ...base, requestKey: newKey(), now: now + 60_000 });
  assert.equal(later.job!.kind, "duplicate");
  assert.equal((db.prepare("SELECT count(*) n FROM audit_logs WHERE action = 'reprint_bill' AND entity_id = ?").get(String(billNo)) as { n: number }).n, 2);
});

test("copies apply to the original, not to a reprint", async () => {
  await call("PUT", `/print/terminals/${TERMINAL}`, { copies: 2 }, superToken);
  const billNo = makeBill();
  const first = (await print(billNo)).json() as PrintPayload;
  const count = (p: PrintPayload) => printableBytes(Buffer.from(p.escpos_base64, "base64")).split("THANK YOU").length - 1;
  assert.equal(count(first), 2);
  await call("PATCH", `/print-jobs/${first.job!.id}`, { status: "sent" });
  assert.equal(count((await print(billNo)).json() as PrintPayload), 1);
  await call("PUT", `/print/terminals/${TERMINAL}`, { copies: 1 }, superToken);
});

const doc: ReceiptDocument = {
  width: 48,
  blocks: [
    { kind: "text", text: "Hello", align: "center", bold: true, double: true },
    { kind: "rule" },
    { kind: "qr", data: "https://x.example/i/1" },
  ],
};

test("the ESC/POS output starts clean, sets the page, styles text and cuts only when told", () => {
  const withCut = renderEscPos(doc, terminal({ auto_cut: true, encoding: "cp437" }), null);
  assert.deepEqual([...withCut.subarray(0, 2)], [0x1b, 0x40], "initialise");
  assert.deepEqual([...withCut.subarray(2, 5)], [0x1b, 0x74, 0], "code page");
  assert.ok(withCut.includes(Buffer.from([0x1b, 0x61, 1])), "centre");
  assert.ok(withCut.includes(Buffer.from([0x1b, 0x45, 1])), "bold");
  assert.ok(withCut.includes(Buffer.from([0x1d, 0x21, 0x11])), "double size");
  assert.deepEqual([...withCut.subarray(-4)], [0x1d, 0x56, 0x42, 0], "partial cut after feeding past the cutter");
  const noCut = renderEscPos(doc, terminal({ auto_cut: false }), null);
  assert.ok(!noCut.includes(Buffer.from([0x1d, 0x56])), "no cut command at all");
  const ascii = renderEscPos(doc, terminal({ encoding: "ascii" }), null);
  assert.ok(!ascii.includes(Buffer.from([0x1b, 0x74])), "ascii leaves the printer's page alone");
  assert.ok(renderEscPos(doc, terminal({ encoding: "cp858" }), null).includes(Buffer.from([0x1b, 0x74, 19])));
});

test("the QR command carries its length and data, and the logo its size", () => {
  const data = "https://x.example/i/1";
  const out = renderEscPos(doc, terminal(), null);
  const store = data.length + 3;
  const at = out.indexOf(Buffer.from([0x1d, 0x28, 0x6b, store & 0xff, store >> 8, 0x31, 0x50, 0x30]));
  assert.ok(at > 0);
  assert.equal(out.subarray(at + 8, at + 8 + data.length).toString(), data);
  assert.ok(out.includes(Buffer.from([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30])), "print symbol");

  const logo = { width: 16, height: 2, raster_base64: Buffer.from([0xff, 0x00, 0x0f, 0xf0]).toString("base64"), preview_data_url: "" };
  const withLogo = renderEscPos({ width: 48, blocks: [{ kind: "logo" }] }, terminal(), logo);
  assert.ok(withLogo.includes(Buffer.from([0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0xff, 0x00, 0x0f, 0xf0])));
  assert.ok(!renderEscPos({ width: 48, blocks: [{ kind: "logo" }] }, terminal(), null).includes(Buffer.from([0x1d, 0x76])));
});

test("characters a printer can't show become readable or a plain question mark", () => {
  assert.equal(encodeText("₹100", "ascii").toString(), "Rs.100");
  assert.deepEqual([...encodeText("é", "cp437")], [0x82]);
  assert.deepEqual([...encodeText("é", "ascii")], [0x3f]);
  assert.deepEqual([...encodeText("€", "cp858")], [0xd5]);
  assert.deepEqual([...encodeText("€", "cp437")], [0x3f]);
  assert.deepEqual([...encodeText("த", "cp437")], [0x3f]);
  assert.deepEqual([...encodeText("a\x1b@b\n", "cp437")], [0x61, 0x3f, 0x40, 0x62, 0x3f], "a name can't smuggle in a printer command");
});

test("wrapping keeps every word and splits only what can't fit", () => {
  assert.deepEqual(wrapText("one two three", 7), ["one two", "three"]);
  assert.deepEqual(wrapText("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrapText("   ", 10), []);
});

test("the QR on a receipt opens that bill, for as long as settings say", async () => {
  await call("PUT", `/print/terminals/${TERMINAL}`, { show_qr: true }, superToken);
  const billNo = makeBill();
  const { document } = (await print(billNo)).json() as PrintPayload;
  await call("PUT", `/print/terminals/${TERMINAL}`, { show_qr: false }, superToken);
  const qr = document.blocks.find((b) => b.kind === "qr") as { data: string };
  const url = new URL(qr.data);
  assert.equal(url.pathname, `/i/${billNo}`);
  const decoded = app.jwt.decode(url.searchParams.get("t")!) as { sub: string; role: string; exp: number; iat: number };
  assert.equal(decoded.sub, String(billNo));
  assert.equal(decoded.role, "invoice");
  assert.equal(decoded.exp - decoded.iat, 7 * 86400);
});

test("QR and logo stay off until switched on", async () => {
  const { document } = (await call("GET", `/bills/${makeBill()}/receipt`)).json() as PrintPayload;
  assert.ok(!document.blocks.some((b) => b.kind === "qr" || b.kind === "logo"));
});

test("settings are checked and kept per terminal", async () => {
  const saved = (await call("PUT", `/print/terminals/${TERMINAL_2}`, { connection: "bridge_lan", host: "192.168.1.50", port: 9100, paper_mm: 58, chars_per_line: 32, copies: 2, auto_print: true }, superToken)).json() as TerminalPrinterSettings;
  assert.equal(saved.connection, "bridge_lan");
  assert.equal(saved.paper_mm, 58);
  const first = (await call("GET", `/print/terminals/${TERMINAL}`)).json() as TerminalPrinterSettings;
  assert.equal(first.connection, "browser");
  const again = (await call("GET", `/print/terminals/${TERMINAL_2}`)).json() as TerminalPrinterSettings;
  assert.equal(again.host, "192.168.1.50");

  // Bad values fall back to what was there, or are refused outright.
  const cleaned = (await call("PUT", `/print/terminals/${TERMINAL_2}`, { connection: "fax", copies: 99, port: 70000, chars_per_line: 500, paper_mm: 100 }, superToken)).json() as TerminalPrinterSettings;
  assert.deepEqual([cleaned.connection, cleaned.copies, cleaned.port, cleaned.chars_per_line, cleaned.paper_mm], ["bridge_lan", 2, 9100, 32, 58]);
  assert.equal((await call("PUT", `/print/terminals/${TERMINAL_2}`, { host: "http://x;rm" }, superToken)).statusCode, 400);
  assert.equal((await call("GET", "/print/terminals/x", undefined)).statusCode, 400);

  const logo = { width: 16, height: 2, raster_base64: Buffer.from([1, 2, 3]).toString("base64"), preview_data_url: "data:image/png;base64,AA" };
  assert.equal((await call("PUT", "/print/settings", { logo }, superToken)).statusCode, 400, "wrong raster size");
  const good = { ...logo, raster_base64: Buffer.from([1, 2, 3, 4]).toString("base64") };
  assert.equal((await call("PUT", "/print/settings", { logo: good }, superToken)).statusCode, 200);
  assert.equal((await call("PUT", "/print/settings", { logo: null }, superToken)).json().logo, null);
});

test("the test page says it isn't a bill and creates no job", async () => {
  const jobs = () => (db.prepare("SELECT count(*) n FROM print_jobs").get() as { n: number }).n;
  const before = jobs();
  const res = (await call("POST", "/print/test", { settings: { chars_per_line: 32, paper_mm: 58 } }, ownerToken)).json() as PrintPayload;
  assert.match(res.text, /TEST PRINT - NOT A BILL/);
  assert.match(res.text, /12345678901234567890123456789012/);
  assert.equal(res.job, null);
  assert.ok(Buffer.from(res.escpos_base64, "base64").length > 0);
  assert.equal(jobs(), before);
});

test("the PDF is a receipt-sized document, and downloading it is recorded", async () => {
  const billNo = makeBill({ payment: "credit", customer: "C01", lines: [["D01", 1, 1000, 847.46, 18, 152.54, 1000]] });
  const res = await call("GET", `/bills/${billNo}/receipt.pdf?terminal_id=${TERMINAL}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/pdf");
  assert.ok(res.rawPayload.subarray(0, 5).toString() === "%PDF-");
  const box = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(res.rawPayload.toString("latin1"));
  assert.ok(box, "has a page size");
  assert.ok(Math.abs(Number(box![1]) - (80 * 72) / 25.4) < 1, "80 mm wide");
  assert.equal((db.prepare("SELECT count(*) n FROM audit_logs WHERE action = 'download_receipt_pdf' AND entity_id = ?").get(String(billNo)) as { n: number }).n, 1);
  assert.equal((await call("GET", "/bills/999999/receipt.pdf")).statusCode, 404);
});

test("the receipt shows the station's clock, while bill_date stays in UTC for shift totals", async () => {
  const res = await call("POST", "/bills", { paymentType: "cash", lines: [{ item_code: "A01", qty: 1 }] });
  assert.equal(res.statusCode, 201, res.body);
  const billNo = (res.json() as { bill: { bill_no: number } }).bill.bill_no;
  const row = db.prepare("SELECT bill_date, local_time FROM bills WHERE bill_no = ?").get(billNo) as { bill_date: string; local_time: string };
  const clock = (timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  const seconds = (t: string) => t.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
  const close = (a: string, b: string) => {
    const gap = Math.abs(seconds(a) - seconds(b));
    return gap < 5 || gap > 86395;
  };
  assert.ok(close(row.local_time, clock("Asia/Kolkata")), `local_time ${row.local_time}`);
  assert.ok(close(row.bill_date.slice(11, 19), clock("UTC")), `bill_date ${row.bill_date}`);
  const { text } = (await call("GET", `/bills/${billNo}/receipt`)).json() as PrintPayload;
  assert.ok(text.includes(`Time :${row.local_time}`), "the receipt prints the local time");
});

test("a bill with no local time prints what bill_date holds", async () => {
  const { text } = (await call("GET", `/bills/${makeBill({ date: "2019-06-13 22:22:31" })}/receipt`)).json() as PrintPayload;
  assert.match(text, /Time :22:22:31/);
});

test("unknown bills and bad requests are refused", async () => {
  assert.equal((await call("GET", "/bills/999999/receipt")).statusCode, 404);
  assert.equal((await print(999999)).statusCode, 404);
  assert.equal((await call("POST", `/bills/${makeBill()}/print-jobs`, { terminal_id: TERMINAL })).statusCode, 400);
  assert.equal((await call("PATCH", "/print-jobs/999999", { status: "sent" })).statusCode, 404);
  assert.equal((await call("POST", "/print-jobs/999999/retry", {})).statusCode, 404);
});

test("a preview's plain text matches what the document holds", () => {
  const text = renderText({ width: 20, blocks: [{ kind: "text", text: "Hi", align: "right" }, { kind: "rule" }, { kind: "logo" }, { kind: "qr", data: "x" }] });
  assert.equal(text.split("\n")[0], " ".repeat(18) + "Hi");
  assert.equal(text.split("\n")[1], "-".repeat(20));
});
