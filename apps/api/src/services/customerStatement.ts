import { db } from "../db/client.js";
import { customersRepo } from "../repositories/customers.js";
import { tenantsRepo, type Tenant } from "../repositories/tenants.js";
import { getCustomerLedger } from "./ledger.js";
import { moneyWords } from "./money.js";

/**
 * Customer statement — port of the legacy CWS.PRG "Customer Wise Sales Report" (only CWS.FXP
 * survives; behaviour reconstructed from it plus the four report forms it drives):
 *
 *   CWS.FRX     plain statement                      (130 col, 66 lines/page)
 *   CWSWO.FRX   with opening balance / receipts       (130 col, 66 lines/page)
 *   CWSG.FRX    grouped by vehicle                    (75 col, 65 lines/page)
 *   CWSGWO.FRX  grouped by vehicle, with opening      (75 col, 65 lines/page)
 *
 * The legacy prompt screen asked for customer, start/end date, vehicle no., "group by veh no" and
 * "print opening & closing amt's" — the last two pick the form. Output is rendered as fixed-width
 * text pages using the FRX row/column positions, so the PDF and on-screen preview line up the way
 * the dot-matrix printout did.
 */

export interface StatementLine {
  bill_date: string;
  bill_no: number;
  order_no: string | null;
  vehicle_no: string | null;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface CustomerStatementOptions {
  customerCode: string;
  from: string;
  to: string;
  /** Legacy `alltrim(a.veh_no)=alltrim(vehno)` under SET EXACT OFF — blank matches every
   *  vehicle, otherwise a prefix match. */
  vehicleNo?: string;
  groupByVehicle?: boolean;
  withOpening?: boolean;
}

export interface CustomerStatement {
  form: "CWS" | "CWSWO" | "CWSG" | "CWSGWO";
  customer: { code: string; name: string; service_charge: number };
  from: string;
  to: string;
  vehicle_no: string | null;
  lines: StatementLine[];
  bill_count: number;
  total_qty: number;
  total_amount: number;
  service_charge_amount: number;
  /** Ledger balance as on `from` (legacy getbals(1)) — only used by the *WO forms. */
  opening_balance: number;
  /** Receipts between `from` and `to` (legacy getbals(3)) — only used by the *WO forms. */
  receipts: number;
  /** Before rounding: total + service charge (+ opening − receipts on the *WO forms). */
  net_balance: number;
  net_amount: number;
  round_off: number;
  amount_in_words: string;
  width: number;
  page_length: number;
  pages: string[][];
}

/** FoxPro ROUND(): half away from zero (Math.round rounds -0.5 towards +∞). */
export function foxRound(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return (Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9)) / f;
}

function fmtDate(iso: string, shortYear = false): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${shortYear ? y.slice(2) : y}`;
}

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * FoxPro numeric PICTURE such as "9,99,999.99" — digits fill right to left, a comma only shows
 * when a digit sits to its left. `@Z` blanks a zero. Where FoxPro would print asterisks on
 * overflow, the plain number is returned instead and allowed to spill left (see `right()`):
 * a statement total is no use as "********".
 */
function pic(n: number, picture: string): string {
  const zeroBlank = picture.startsWith("@Z ");
  const template = zeroBlank ? picture.slice(3) : picture;
  if (zeroBlank && foxRound(n, 2) === 0) return "";

  const [intTpl, decTpl = ""] = template.split(".");
  const fixed = Math.abs(n).toFixed(decTpl.length);
  const [intDigits, decDigits] = fixed.split(".");
  const sign = n < 0 && Number(fixed) !== 0 ? "-" : "";

  const out: string[] = [];
  let di = intDigits.length - 1;
  for (let ti = intTpl.length - 1; ti >= 0; ti--) {
    if (intTpl[ti] === ",") {
      out.unshift(di >= 0 ? "," : " ");
    } else {
      out.unshift(di >= 0 ? intDigits[di] : " ");
      di--;
    }
  }
  if (di >= 0) return sign + intDigits + (decDigits ? `.${decDigits}` : "");
  const body = out.join("").trimStart();
  const text = sign + body + (decDigits !== undefined ? `.${decDigits}` : "");
  return text.padStart(template.length, " ");
}

/** A numeric field with no PICTURE — FoxPro shows the value at its stored decimals. */
function num(n: number, decimals = 2): string {
  return foxRound(n, decimals).toFixed(decimals);
}

/** Service charge % in a narrow (3–4 col) field: as many decimals as will fit. */
function pct(n: number, width: number): string {
  for (const d of [2, 1, 0]) {
    const s = n.toFixed(d);
    if (s.length <= width) return s;
  }
  return n.toFixed(0);
}

/** One printed line; later writes overlay earlier ones, but padding spaces never erase text —
 *  same as FoxPro drawing report objects in definition order. */
class Row {
  private chars: string[] = [];

  put(col: number, text: string): this {
    const start = Math.max(0, col);
    for (let i = 0; i < text.length; i++) {
      while (this.chars.length < start + i) this.chars.push(" ");
      if (text[i] !== " " || this.chars[start + i] === undefined) this.chars[start + i] = text[i];
    }
    return this;
  }

  /** Character field: left-aligned and truncated to the field width, as FoxPro does. */
  left(col: number, width: number, text: string): this {
    return this.put(col, text.slice(0, width));
  }

  /** Right-justified (STYLE "J"/numeric) field. Over-wide values spill left rather than truncate. */
  right(col: number, width: number, text: string): this {
    const t = text.trim();
    return this.put(col + width - t.length, t);
  }

  /** Centered (STYLE "C" / "@I") field. Over-wide values stay centered on the field. */
  center(col: number, width: number, text: string): this {
    const t = text.trim();
    return this.put(col + Math.floor((width - t.length) / 2), t);
  }

  toString(): string {
    return this.chars.join("").trimEnd();
  }
}

const rep = (ch: string, n: number) => ch.repeat(n);

interface Layout {
  width: number;
  pageLength: number;
  footerHeight: number;
  title(tenant: Tenant, printedOn: string): Row[];
  /** `firstPage` = the report's BOOL variable still at its initial 1 (no record printed yet). */
  pageHeader(firstPage: boolean, balfwd: number): Row[];
  /** `more` = legacy `recno()<>reccount()` — records remain after this page. */
  pageFooter(more: boolean, balfwd: number, tenant: Tenant): Row[];
  detail(line: StatementLine): Row;
  groupFooter?(groupTotal: number): Row;
  summary(s: CustomerStatement, tenant: Tenant): Row[];
}

function wideLayout(withOpening: boolean, opening: number, from: string): Layout {
  // CWSWO shifts the balance captions one column right of CWS (col 70 vs 69).
  const capCol = withOpening ? 70 : 69;
  const bal = (balfwd: number) => balfwd + (withOpening ? opening : 0);
  return {
    width: 130,
    pageLength: 66,
    footerHeight: 3,
    title: (tenant, printedOn) => [
      new Row(),
      new Row(),
      new Row().put(0, rep("=", 76)),
      new Row().put(19, tenant.name),
      new Row().center(19, 30, tenant.address_line1 ?? ""),
      new Row().center(19, 30, tenant.address_line2 ?? "").put(61, fmtDate(printedOn)),
    ],
    pageHeader: (firstPage, balfwd) => {
      const bd = new Row();
      if (!firstPage) {
        bd.right(capCol, 35, "Balance B/D").right(106, 12, pic(bal(balfwd), "@Z 999999999.99"));
      } else if (withOpening) {
        bd.right(capCol, 35, `Opening Balance as on ${fmtDate(from)}`).right(106, 12, pic(opening, "@Z 999999999.99"));
      }
      return [
        new Row().put(0, rep("=", 130)),
        new Row()
          .put(0, "Bill_date")
          .put(16, "Bill_no")
          .put(29, "Ref No.")
          .put(42, "Vehicle No.")
          .put(58, "Item-Name")
          .put(78, "Quantity")
          .put(92, "Unit Rate")
          .put(112, "Amount"),
        new Row().put(0, rep("-", 130)),
        bd,
      ];
    },
    pageFooter: (more, balfwd, tenant) => [
      more ? new Row().put(0, rep("-", 130)) : new Row(),
      more ? new Row().right(capCol, 35, "Balance C/F").right(106, 12, pic(bal(balfwd), "@Z 999999999.99")) : new Row(),
      new Row().put(withOpening ? 21 : 18, tenant.tagline ?? ""),
    ],
    detail: (l) =>
      new Row()
        .put(0, fmtDate(l.bill_date))
        .left(16, 10, String(l.bill_no))
        .right(29, 6, (l.order_no ?? "").slice(0, 6))
        .left(42, 13, l.vehicle_no ?? "")
        .left(58, 15, l.item_name)
        .right(77, 8, pic(l.qty, "99999.99"))
        .right(91, 10, num(l.rate))
        .right(108, 10, pic(l.amount, "9,99,999.99")),
    summary: (s, tenant) => {
      if (!withOpening) {
        return [
          new Row().put(0, rep("-", 130)),
          new Row()
            .put(0, "No. of Bills :")
            .put(15, String(s.bill_count))
            .right(76, 9, pic(s.total_qty, "99,999.99"))
            .put(86, "Grand Total:")
            .put(99, "Rs.")
            .right(102, 16, pic(s.total_amount, "9,999,999,999.99")),
          new Row()
            .put(79, "Service Charge(")
            .right(94, 4, pct(s.customer.service_charge, 4))
            .put(98, "%")
            .put(99, ")")
            .right(104, 14, num(s.service_charge_amount)),
          new Row().left(4, 70, s.amount_in_words).put(105, rep("-", 13)),
          new Row().right(103, 15, num(s.net_balance)),
          new Row().put(89, "Round up: Rs.").right(112, 6, pic(s.round_off, "99.99")),
          new Row().put(105, rep("-", 13)),
          new Row().put(87, "Net Amount :Rs.").right(102, 16, pic(s.net_amount, "9,999,999,999.99")),
          new Row().put(105, rep("=", 13)),
          new Row().put(83, `For ${tenant.name}`),
        ];
      }
      return [
        new Row().put(0, rep("-", 130)),
        new Row()
          .put(0, "No. of Bills :")
          .put(15, String(s.bill_count))
          .put(71, "Tot Qty:")
          .right(80, 7, pic(s.total_qty, "99999.9"))
          .put(90, "Grand Total:")
          .right(102, 16, pic(s.total_amount + s.opening_balance, "9,999,999,999.99"))
          .put(102, "Rs."),
        new Row()
          .put(60, "Service Charge ")
          .right(75, 4, pct(s.customer.service_charge, 4))
          .put(79, "%")
          .put(81, "on ")
          .put(84, "Rs.")
          .put(87, num(s.total_amount))
          .right(104, 14, num(s.service_charge_amount)),
        new Row().put(105, rep("-", 13)),
        new Row()
          .left(4, 70, s.amount_in_words)
          .right(103, 15, num(s.total_amount + s.service_charge_amount + s.opening_balance)),
        new Row()
          .put(61, "Receipts From")
          .put(75, fmtDate(s.from))
          .put(86, "To")
          .put(89, fmtDate(s.to))
          .put(100, "Rs.")
          .right(104, 14, pic(s.receipts, "99999999.99")),
        new Row().put(105, rep("-", 13)),
        new Row().put(84, "Net Balance").put(98, "Rs.").right(102, 15, num(s.net_balance)),
        new Row().put(88, "Round up: Rs.").right(111, 6, pic(s.round_off, "99.99")),
        new Row().put(104, rep("-", 13)),
        new Row().put(86, "Net Amount :Rs.").right(101, 16, pic(s.net_amount, "9,999,999,999.99")),
        new Row().put(104, rep("=", 13)),
        new Row().put(57, `For ${tenant.name}`),
      ];
    },
  };
}

function groupedLayout(withOpening: boolean, opening: number, from: string): Layout {
  const bal = (balfwd: number) => balfwd + (withOpening ? opening : 0);
  return {
    width: 75,
    pageLength: 65,
    footerHeight: 3,
    title: (tenant, printedOn) => [
      new Row(),
      new Row(),
      new Row().put(0, rep("=", 75)),
      new Row().center(17, 40, tenant.name),
      new Row().center(17, 40, tenant.address_line1 ?? ""),
      new Row().center(17, 40, tenant.address_line2 ?? "").put(withOpening ? 61 : 64, fmtDate(printedOn)),
    ],
    pageHeader: (firstPage, balfwd) => {
      const bd = new Row();
      if (!firstPage) {
        bd.right(27, 35, "Balance B/D").right(63, 12, pic(bal(balfwd), "@Z 999999999.99"));
      } else if (withOpening) {
        bd.right(27, 35, `Opening Balance as on ${fmtDate(from)}`).right(63, 12, pic(opening, "@Z 999999999.99"));
      }
      return [
        new Row().put(0, rep("=", 75)),
        new Row()
          .put(0, "BillDate")
          .put(withOpening ? 9 : 10, withOpening ? "BillNo." : "BillNo")
          .put(17, "O.No.")
          .put(23, "Veh No.")
          .put(36, "Item-Name")
          .put(49, "Quantity")
          .put(59, " Rate")
          .put(69, "Amount"),
        new Row().put(0, rep("-", 75)),
        bd,
      ];
    },
    pageFooter: (more, balfwd, tenant) => [
      more ? new Row().put(0, rep("-", 75)) : new Row(),
      more
        ? withOpening
          ? new Row().right(26, 35, "Balance C/F").right(62, 13, pic(bal(balfwd), "@Z 999999999.99"))
          : new Row().right(27, 35, "Balance C/F").right(63, 12, pic(balfwd, "@Z 999999999.99"))
        : new Row(),
      new Row().put(withOpening ? 18 : 17, tenant.tagline ?? ""),
    ],
    detail: (l) =>
      new Row()
        .put(0, fmtDate(l.bill_date, true))
        .left(9, 7, String(l.bill_no))
        .left(17, 4, l.order_no ?? "")
        .left(22, 12, l.vehicle_no ?? "")
        .left(35, 12, l.item_name)
        .right(48, 8, pic(l.qty, "99999.99"))
        // CWSG derives the rate from amt/qty; CWSGWO prints the stored rate.
        .right(57, 7, pic(withOpening || !l.qty ? l.rate : foxRound(l.amount / l.qty, 2), "99999.99"))
        .right(65, 10, pic(l.amount, "9,99,999.99")),
    groupFooter: (total) => new Row().put(37, "Vehicle Wise Total Amt :").right(62, 13, num(total)),
    summary: (s) => {
      if (!withOpening) {
        return [
          new Row().put(0, rep("-", 75)),
          new Row()
            .put(21, "Tot Qty :")
            .right(32, 9, pic(s.total_qty, "99,999.99"))
            .put(42, "Grand Total:")
            .put(55, "Rs.")
            .right(59, 16, pic(s.total_amount, "9,999,999,999.99")),
          new Row()
            .put(0, "No. of Bills :")
            .put(15, String(s.bill_count))
            .put(37, "Service Charge(")
            .right(52, 3, pct(s.customer.service_charge, 3))
            .put(55, "%")
            .put(56, ")")
            .right(61, 14, num(s.service_charge_amount)),
          new Row().put(62, rep("-", 13)),
          new Row().right(60, 15, num(s.net_balance)),
          new Row().put(46, "Round up: Rs.").right(69, 6, pic(s.round_off, "99.99")),
          new Row().put(62, rep("-", 13)),
          new Row().put(44, "Net Amount :Rs.").right(59, 16, pic(s.net_amount, "9,999,999,999.99")),
          new Row().put(62, rep("=", 13)),
          new Row().left(0, 70, s.amount_in_words),
        ];
      }
      return [
        new Row().put(0, rep("-", 75)),
        new Row()
          .put(0, "No. of Bills :")
          .put(15, String(s.bill_count))
          .put(25, "Tot Qty:")
          .right(33, 7, pic(s.total_qty, "99999.9"))
          .put(43, "Grand Total:")
          .put(56, "Rs.")
          .right(59, 16, pic(s.total_amount + s.opening_balance, "9,999,999,999.99")),
        new Row()
          .put(14, "Service Charge ")
          .right(29, 4, pct(s.customer.service_charge, 4))
          .put(33, "%")
          .put(35, "on ")
          .put(38, "Rs.")
          .put(41, num(s.total_amount))
          .right(61, 14, num(s.service_charge_amount)),
        new Row().put(62, rep("-", 13)),
        new Row().right(60, 15, num(s.total_amount + s.service_charge_amount + s.opening_balance)),
        new Row()
          .put(18, "Receipts From")
          .put(32, fmtDate(s.from))
          .put(43, "To")
          .put(46, fmtDate(s.to))
          .put(57, "Rs.")
          .right(61, 14, pic(s.receipts, "99999999.99")),
        new Row().put(62, rep("-", 13)),
        new Row().put(41, "Net Balance").put(55, "Rs.").right(59, 15, num(s.net_balance)),
        new Row().put(45, "Round up: Rs.").right(68, 6, pic(s.round_off, "99.99")),
        new Row().put(61, rep("-", 13)),
        new Row().put(43, "Net Amount :Rs.").right(58, 16, pic(s.net_amount, "9,999,999,999.99")),
        new Row().put(61, rep("=", 13)),
      ];
    },
  };
}

/**
 * FoxPro DOS band pagination: report heading + title band (page 1 only) + page header, detail
 * rows until only the page-footer rows remain, page footer pinned to the bottom of the page. The
 * summary band prints after the last record, on a fresh page if it doesn't fit.
 *
 * The heading line ("SALES REPORT OF <customer> From .. To ..") is CWS.PRG's REPORT FORM
 * HEADING text — the forms themselves carry no customer name.
 */
function paginate(s: CustomerStatement, layout: Layout, tenant: Tenant, printedOn: string): string[][] {
  const heading = `SALES REPORT OF ${s.customer.name.toUpperCase()} From ${fmtDate(s.from)} To ${fmtDate(s.to)}`;
  const pages: string[][] = [];
  const bodyLimit = layout.pageLength - layout.footerHeight;
  let page: string[] = [];
  let balfwd = 0;
  let printed = 0;

  const render = (rows: Row[]) => rows.map((r) => r.toString());

  const startPage = () => {
    page = [new Row().center(0, layout.width, heading).toString()];
    if (pages.length === 0) page.push(...render(layout.title(tenant, printedOn)));
    page.push(...render(layout.pageHeader(printed === 0, balfwd)));
  };
  const endPage = () => {
    while (page.length < bodyLimit) page.push("");
    page.push(...render(layout.pageFooter(printed < s.lines.length, balfwd, tenant)));
    pages.push(page);
  };
  const emit = (rows: Row[]) => {
    if (page.length + rows.length > bodyLimit) {
      endPage();
      startPage();
    }
    page.push(...render(rows));
  };

  startPage();
  let groupKey: string | null | undefined;
  let groupTotal = 0;
  s.lines.forEach((line, i) => {
    if (layout.groupFooter && line.vehicle_no !== groupKey) {
      emit([new Row()]); // CWSG's (empty) group header band
      groupKey = line.vehicle_no;
      groupTotal = 0;
    }
    emit([layout.detail(line)]);
    printed++;
    balfwd += line.amount;
    groupTotal += line.amount;
    if (layout.groupFooter && s.lines[i + 1]?.vehicle_no !== groupKey) {
      emit([layout.groupFooter(groupTotal)]);
    }
  });
  emit(layout.summary(s, tenant));
  endPage();
  return pages;
}

function loadLines(opts: CustomerStatementOptions): StatementLine[] {
  const vehicle = (opts.vehicleNo ?? "").trim();
  const order = opts.groupByVehicle
    ? "b.vehicle_no, date(b.bill_date), b.bill_no, l.id"
    : "date(b.bill_date), b.bill_no, l.id";
  return db
    .prepare(
      `SELECT date(b.bill_date) AS bill_date, b.bill_no, b.order_no, b.vehicle_no,
              COALESCE(i.name, l.item_code) AS item_name, l.qty, l.rate, l.amount
       FROM bills b
       JOIN bill_lines l ON l.bill_no = b.bill_no
       LEFT JOIN items i ON i.code = l.item_code
       WHERE b.customer_code = ? AND b.payment_type = 'credit' AND b.status != 'cancelled'
         AND date(b.bill_date) BETWEEN ? AND ?
         AND (? = '' OR UPPER(COALESCE(b.vehicle_no, '')) LIKE UPPER(?) || '%')
       ORDER BY ${order}`,
    )
    .all(opts.customerCode, opts.from, opts.to, vehicle, vehicle) as unknown as StatementLine[];
}

export function getCustomerStatement(
  opts: CustomerStatementOptions,
  printedOn: string = todayIso(),
): CustomerStatement {
  const customer = customersRepo.get(opts.customerCode);
  if (!customer) throw new Error(`Unknown customer code: ${opts.customerCode}`);
  if (opts.from > opts.to) throw new Error("From date must be on or before To date");

  const withOpening = Boolean(opts.withOpening);
  const groupByVehicle = Boolean(opts.groupByVehicle);
  const lines = loadLines(opts);

  // getbals(1)/getbals(3): same opening/bill/receipt ledger the Customers screen shows.
  let opening = 0;
  let receipts = 0;
  if (withOpening) {
    const ledger = getCustomerLedger(opts.customerCode, opts.from, opts.to);
    opening = ledger[0]?.balance ?? 0;
    receipts = ledger.filter((e) => e.type === "receipt").reduce((sum, e) => sum + e.credit, 0);
  }

  const totalAmount = foxRound(lines.reduce((sum, l) => sum + l.amount, 0), 2);
  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
  const serviceCharge = foxRound((totalAmount * customer.service_charge) / 100, 2);
  const netBalance = foxRound(totalAmount + serviceCharge + opening - receipts, 2);
  const netAmount = foxRound(netBalance, 0);

  const statement: CustomerStatement = {
    form: groupByVehicle ? (withOpening ? "CWSGWO" : "CWSG") : withOpening ? "CWSWO" : "CWS",
    customer: { code: customer.code, name: customer.name, service_charge: customer.service_charge },
    from: opts.from,
    to: opts.to,
    vehicle_no: opts.vehicleNo?.trim() || null,
    lines,
    bill_count: new Set(lines.map((l) => l.bill_no)).size,
    total_qty: totalQty,
    total_amount: totalAmount,
    service_charge_amount: serviceCharge,
    opening_balance: opening,
    receipts,
    net_balance: netBalance,
    net_amount: netAmount,
    round_off: foxRound(netAmount - netBalance, 2),
    amount_in_words: `${moneyWords(Math.abs(netAmount))} Rupees Only`.trim(),
    width: 0,
    page_length: 0,
    pages: [],
  };

  const layout = groupByVehicle
    ? groupedLayout(withOpening, opening, opts.from)
    : wideLayout(withOpening, opening, opts.from);
  statement.width = layout.width;
  statement.page_length = layout.pageLength;
  statement.pages = paginate(statement, layout, tenantsRepo.get(), printedOn);
  return statement;
}
