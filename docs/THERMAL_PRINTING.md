# Thermal bill printing

How PetroPro prints bills on 80 mm and 58 mm ESC/POS receipt printers, what it migrated from Petbill,
and how to set it up.

## 1. Legacy analysis

### Sources

`PetBill/WORKAREA/PRINTBIL.PRG` isn't in this repository's history. What exists, in commit `77bb4b0`
under `legacy/Workarea/`:

| File | What it gave |
| ---- | ------------ |
| `PRINTBIL.BAK` | Source of the print routine, one version behind the running program |
| `Petbill.exe` | Compiled `PRNBILDI` (first print) and `PRINTBIL` (duplicate), read through their string tables. The authority where the two differ |
| `X.TXT` | A real receipt, written by Petbill in print test mode |
| `BILLEN.BAK` | Source of bill entry: rounding, save choices, the call into printing |
| `MAINMENU.PRG`, `ASSGNHDR.BAK`, `HEADER.PRG` | Menu wiring (`lastbil`, `bildup`) and the header |
| `STRDEC.PRG`, `PRNCNBIL.PRG`, `PRINTWIN.PRG` | Total formatting, the cancellation screen, the "PRINTING" window |
| `JUNBIL19.DBF` and others, `ITEM`, `CUSTOMER`, `USERTAB`, `MAGE19`, `SETTINGS`, `BILLNO` | Field layouts, and real rows to check against |

`BILLEN` has no compiled source for `prnbildi`, `lastbil` or `bildup`, so those are known from the string
tables: their text and the order of it, not every line of logic.

### How printing is reached

- **Bill entry (`BILLEN`):** the cashier picks Save & Continue, Save & NoPrint, Save & Exit or Cancel. Credit
  bills also have Print Intimation. Save & Continue calls `prnbildi` if `PRINTSTATUS()` is true, and only then
  posts stock and appends the bill. It keeps the last three bills in `PREVBILLS`.
- **Print Previous Bill (`lastbil`):** reprints through `PRINTBIL`.
- **Print Duplicate Bill (`bildup`):** asks for number, financial year and type, finds the month through
  `BILSEK<YY>`, prints the `DUPLICATE BILL` banner, then calls `PRINTBIL`.

### Business rules found

| Rule | Source | In PetroPro |
| ---- | ------ | ----------- |
| `STATUS` is the bill type: C cash, R credit, K kerosene, each with its own number counter (`BILLNO.DBF`) | `PRINTBIL`, `BILLEN`; all of Apr to Jun 2019: every R row has a customer, no C row does | Heading comes from `payment_type` |
| Line amount is `round(rate * qty, 2)`, or the amount typed with quantity worked back from it | `BILLEN` | Already stored on the bill. The receipt never recalculates a line |
| Line tax is `qty * unit tax`, printed only when above zero | `BILLEN`, `PRINTBIL` | Same |
| Base total adds `ratebtx * qty` on a taxed line and `amt` on an untaxed one | `PRINTBIL` | Changed, with the owner's approval: see "Approved change" |
| Total adds the line amounts, with no rounding to the rupee | `PRINTBIL` | Same |
| Rate, quantity and amount print to 2 decimals, though `QTY` holds 3 | `PICTURE` clauses, `X.TXT` | Same by default, 3 is a setting |
| No discount field exists on a bill, and none is printed | `BILL.DBF`, `BILLEN`, `PRINTBIL` | No discount line, as none exists to show |
| `SER_CHG` is stored but not printed | `PRINTBIL` | Same |
| Order number shows on credit bills | `PRINTBIL` | Same, and left out when blank |
| Customer's `PRINT` name shows on credit bills only | `PRINTBIL` | `print_name`, falling back to `name` |
| Vehicle and cashier share a line | `PRINTBIL`, `X.TXT` | Same |
| Mileage and KMR print when the bill has a mileage row | `PRINTBIL` | From `mileage_log` |
| New Year on 1 Jan, Pongal on 14 to 16 Jan, in `PRNBILDI` only | `Petbill.exe` | First print only, a setting |
| Total prints double width | `CHR(14)` in `PRINTBIL`, bytes in `X.TXT` | `GS !` double size |
| Duplicates carry a banner and create no sale | `bildup` | Same, plus an audit entry |
| Kerosene bills print `SHOP NO:` and a wholesale licence line | `PRINTBIL` | Not migrated: PetroPro has no kerosene bill type |
| Test mode writes to `x.txt` instead of printing | `PRINTBIL`, `PRINTTESTMODE` | Print Preview and Test Print |

### Printer commands in Petbill

Petbill drove a dot-matrix style printer through FoxPro's `@ say` with `_PADVANCE="LINEFEEDS"`,
`_PLENGTH=1`. Its only control codes are `CHR(14)` and `CHR(15)` around the total and `CHR(18)` after it.
`PRINTSPECIALCHARACTERS` turns similar codes on for the shop name.

### Differences from Petbill, on purpose

| Petbill | PetroPro | Why |
| ------- | -------- | --- |
| Header prints after the bill, ready for the next one on a continuous roll | Header prints first | A cut receipt has to carry its own header |
| `|` frame, 36 characters wide | No frame, 32 to 64 wide | A frame costs width on paper that's already cut |
| Fixed pictures print `*****` above 99999.99 | Columns widen, and figures move to their own line | Petbill's lose the amount. Figures never change |
| Long item names run into the rate column | Name gets its own line | Same reason |
| Time prints as recorded | Time left out if a bill has none | Some old rows have no `BTIME` |
| Order number prints as `0` when there isn't one | Left out | "No unnecessary lines" in the brief |
| Greeting depends on today's date | Depends on the bill's date | Same result for a bill printed the day it's made |
| Printing happens before stock is posted | The bill is committed first, printing comes after | A print failure can't affect a sale |
| `₹` not available | `Rs.`, the same | Not on these code pages |

### Approved change: the base amount on a receipt

Petbill adds `ratebtx * qty`, with `ratebtx` already rounded to 2 places. Across all 3,606 real bills that differs from
`amount - tax` on one bill by 0.01, but larger fuel quantities drift further: 5 litres at 96.72 gives 409.85 and tax
73.77, adding up to 483.62 against a total of 483.60.

The owner approved printing the stored figures instead on 2026-11-04. The receipt's Amount is `bills.sub_total` and each
line's Bas.Amt is `amount - tax_amount`, so they add up to the total and match the A5 invoice. No bill's stored amount
changes.

## 2. Field mapping

| On the receipt | Petbill | PetroPro |
| -------------- | ------- | -------- |
| Bunk name, address | `Header2` to `Header5` (`ASSGNHDR`) | `tenants.name`, `address_line1`, `address_line2` |
| Contact, statutory lines | `Header1` | `print_settings.header_lines` |
| Tagline | `Header3` | `tenants.tagline` |
| GSTIN | `SETTINGS.GSTNO` | `tenants.gst_no` |
| Heading | `STATUS` | `bills.payment_type` |
| Order no. | `ONO` | `bills.order_no` |
| Bill no. | `BILL_NO` | `bills.bill_no`, and `bills.legacy_bill_no` on an imported bill, printed as Petbill Bill No. |
| Date, time | `BILL_DATE`, `BTIME` | `bills.bill_date` |
| Item | `ITEM.IDESC` by `ICODE` | `items.name` by `bill_lines.item_code` |
| Rate, Qty, Amt | `RATE`, `QTY`, `AMT` | `bill_lines.rate`, `qty`, `amount` |
| Bas.Amt | `RATEBTX * QTY` | `bill_lines.amount - tax_amount` |
| Vat% | `TAX_PER` | `bill_lines.tax_percent` |
| T.Amt | `TAX_AMT` | `bill_lines.tax_amount` |
| Customer | `CUSTOMER.PRINT` | `customers.print_name`, then `name` |
| VNO | `VEH_NO` | `bills.vehicle_no` |
| Cashier | `USERTAB.NAME` | `users.name` by `bills.user_id` |
| MileAge | `MAGE.MILEAGE` | `mileage_log.mileage` |
| KMR | `MAGE.OR`, `CR` | `mileage_log.odometer_prev`, `odometer_curr` |
| Footer | Fixed text | `print_settings.footer_text` |
| Logo, QR | None | New, off by default |

UPI and card have no Petbill equivalent and print as `UPI SALES` and `CARD SALES`.

## 3. How it fits together

```
Billing screen ── POST /bills/:no/print-jobs ──> API: decides original or duplicate, renders
      │                                               the receipt, records the job and any audit entry
      │  <── receipt + ESC/POS bytes ──────────────────┘
      ├── LAN or USB ──> print bridge on this computer ──> printer
      ├── WebUSB or Bluetooth (Chrome) ──────────────────> printer
      └── Browser print dialog ──────────────────────────> any installed printer
      └── PATCH /print-jobs/:id: sent or failed
```

The API is in the cloud and can't see the station's network, and a browser can't open a raw connection,
which is why the bridge exists. `services/receipt.ts` builds the document, `services/escpos.ts` turns it into
printer bytes, and `services/billReceiptPdf.ts` into a PDF, so all outputs come from one layout.

### Rules that prevent duplicates and lost bills

- A bill is committed before printing starts. `print_jobs` holds paper only, and no print route writes to
  bills, stock or dues.
- A bill's first print is its original, enforced by a unique index. Later ones are `duplicate`, carry the
  banner, print one copy and are audited as `reprint_bill`.
- A job that failed retries as the same job, with no banner, and nothing marks it as a reprint.
- Reprints need confirming. A second one within 10 seconds is refused, as is a second terminal while an
  original is printing. A terminal that crashes mid-print releases the bill after 60 seconds.
- The same request key always returns the same job. Auto-print uses a fixed key per bill and terminal.
- The bridge remembers each job it has sent for 10 minutes, so a lost reply can't print it twice.
- Failed receipts are kept on the device and can print while PetroPro is unreachable. Their outcome is
  reported once it's back.
- "Sent" means the printer or dialog accepted it, not that paper came out. If a printer jams afterwards, use
  Reprint.

### Offline limits

- A bill queued offline has no bill number until it syncs, so it can't print as a bill before then. Print it
  from Look up afterwards. The existing reference slip still works.
- A first print needs PetroPro reachable. Retrying a receipt that already failed doesn't.

## 4. Setup

### Choosing a connection

| Connection | Silent | Needs | Best for |
| ---------- | ------ | ----- | -------- |
| Browser print dialog | No | Nothing | Getting started, any printer |
| LAN, through bridge | Yes | Bridge, printer's IP | Counter with a network printer |
| USB, through bridge | Yes | Bridge, installed printer | Counter with a USB printer |
| USB, direct | Yes after first pick | Chrome or Edge | Android tablets. On Windows, the driver usually blocks it |
| Bluetooth | After first pick each session | Chrome, BLE printer | Attendant phones. Classic Bluetooth printers won't work |

For the browser dialog, set the printer's paper to 80 mm roll and margins to none, and turn off headers and
footers in the dialog.

### Installing the bridge on a billing computer

1. Install Node.js 22 or later, and copy the `apps/print-bridge` folder to the computer.
2. Run `node bridge.mjs`. It prints a **pairing token** and where its settings are:
   `%APPDATA%\PetroProBridge\config.json` on Windows.
3. If PetroPro isn't at `https://petropro-demo.vercel.app`, add its address to `origins` there and restart.
4. To start it automatically on Windows:
   `schtasks /create /tn "PetroPro Print Bridge" /sc onlogon /tr "node C:\path\to\print-bridge\bridge.mjs"`
5. In PetroPro: Utilities, then Printer Settings. Choose the connection, paste the token, then Check connection,
   Save and Test Print.

The bridge listens on `127.0.0.1` only, checks the Host header and the site, and needs the token. It accepts
private addresses only, on ports listed in `allowedPorts`, which defaults to 9100 to 9103. Treat the token like
a password. It stays on the computer and in that browser, and is never sent to the server.

### After setting up

Print the test page and check that:
- the row of digits fits one line. If it wraps, lower Characters per line: 48, then 42.
- the paper cuts, and doesn't cut through the last line.
- the centred line is centred.

### Server settings

`STATION_TIME_ZONE` sets the clock on printed receipts, and defaults to `Asia/Kolkata`.

### The time on a bill

`bills.bill_date` holds its time in UTC, because shifts compare it with UTC timestamps to work out each shift's
cash. Receipts use a separate `bills.local_time`, set when a bill is made. Two things follow, and neither is new:

- Bills made before this release have no `local_time`, so a reprint shows their UTC time, 5:30 behind.
- Other screens and the A5 invoice still show UTC time for live bills.

## 5. Verification

Run with `npm run test`, and `npm test` in `apps/print-bridge`. See `AI_Handoff.md` Session 28 for results.

### Needs a real printer

Everything below is untested, because no printer was available. The bytes have been checked against the ESC/POS
command set, not against paper.

- Paper cutting and alignment, on any model
- Characters per line and Font A width on the actual printer
- USB through the Windows spooler (`windows-raw-print.ps1`)
- WebUSB and Web Bluetooth
- The paper-out check, which depends on the printer answering
- QR and logo appearing on paper
- CP437 and CP858 output
- Calling the bridge from the HTTPS production site, including Chrome's local network prompt
- Real-world printer disconnection during a job. Tested only against a fake LAN printer that was switched off
