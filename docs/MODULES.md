# PetroPro — Module Map

Legacy FoxPro menu → modern PetroPro feature, so a future developer can tell which legacy artifact
(if any) a modern feature was derived from. This is the last piece of Phase 0's original scope
(`docs/ROADMAP.md`), written after the fact once there was a concrete modern app to map against.

## How the legacy menu actually works

There are no compiled `.MNX`/`.MNT`/`.MPR` menu files anywhere in `legacy/Workarea/` — the entire
menu is built in code, at runtime, in **`MAINMENU.PRG`** (`DEFINE MENU` / `DEFINE PAD` /
`DEFINE POPUP` / `DEFINE BAR` / `ON SELECTION ... DO <program>`). That file is the real entry point
of the legacy app.

**Important:** most of the programs `MAINMENU.PRG` dispatches to (`group_ad`, `item_ad`, `cust_ad`,
`billcnc`, `magerep`, `rep_gst`, `restore`, `settings`, `calc`, `chguser`, `setfinyr`, `taxChang`,
`stkanyrp`, `vehsrch`, `bcncrep`, and most others) **do not exist as source anywhere in this repo** —
not as `.PRG`, `.FXP`, or `.BAK`. Only a handful of the real business-logic programs survive:
`BILLEN.BAK` (bill entry, no `.PRG` — only the backup file), `IWGSTREP.PRG` (GST item-wise report),
`BACKUP.PRG`, `HEADER.PRG`. For everything else, the modern reimplementation in this repo was
derived from DBF table schemas (`docs/DATA_DICTIONARY.md`), `.FRX` report layouts, and domain
inference — **not** a ported `.PRG`. The table below marks this explicitly per item so nobody
assumes a source file exists when it doesn't.

Source-availability key: 🟢 program source survives · 🟡 report layout only (`.FRX`/`.FRT`) ·
⚪ no artifact survives (inferred from DBF/FRX/domain knowledge only)

## Menu → modern feature

### Maintenance

| Legacy menu item | Legacy target | Source | Modern feature | Phase |
| --- | --- | --- | --- | --- |
| Group Entry | `group_ad`/`ed`/`de`/`ve` | ⚪ | `GET/POST /groups` API only — **no admin UI yet** | 1 |
| Item Entry | `item_ad`/`ed`/`de`/`ve` | ⚪ | `GET/POST/PUT /items` API only — **no admin UI yet** | 1 |
| Purchase Details | `purch_en`/`pur_edit`/`pur_de`/`instock` | ⚪ | `/purchases` page + API | 2/3 |
| CashierEntry (member=2 hidden) | `user_ad`/`ed`/`de`/`ve` | ⚪ | **Not built** — users are created only via `db/seed.ts` or the DBF importer; no user-management API or UI exists | — |
| Customer Entry | `cust_ad`/`ed`/`de`/`ve` | ⚪ | `/customers` page (list, create) + API | 2 |
| Vehicle Master | `vehdetad`/`vehdeted` | ⚪ | `POST/GET /vehicles` API; vehicles are otherwise created implicitly via billing/attendant forms — no dedicated management screen | 1 |

### Bill

| Legacy menu item | Legacy target | Source | Modern feature | Phase |
| --- | --- | --- | --- | --- |
| Bill Entry | `billen` | 🟢 `BILLEN.BAK` | `/billing` (walk-in) + `/attendant`→`/cashier` (pending-transaction flow) | 1/2 |
| Cancel Bill | `billcnc` | ⚪ | `/billing` bill lookup + cancel, `POST /bills/:billNo/cancel` | 2 |
| Receipts (Add/Delete) | `rec_ad`/`rec_de` | ⚪ | `/customers` per-customer receipt form, `POST /receipts` — no delete/void | 2 |
| Close Stock/Date | `datestoc` | ⚪ | `POST /stock/close` (no dedicated UI button outside the API — flagged in `Project_Status.md` as advisory-only, not enforced) | 2 |
| Print Previous Bill / Duplicate Bill | `lastbil`/`bildup` | ⚪ | `GET /bills/last`, `GET /bills/:billNo/pdf` | 2/3 |
| Print Previous/Duplicate Receipt | `lastrec`/`recdup` | ⚪ | **Not built** — receipts have no print/PDF output at all, only the JSON record | — |

### Reports

| Legacy menu item | Legacy target | Source | Modern feature | Phase |
| --- | --- | --- | --- | --- |
| Item Wise Sales Report (daily/periodic/yearly/group) | `itemrep`/`piwr`/`yiwr`/`giwr` | 🟡 IWR family | `/reports` → sales-item, with day/month/year granularity | 3 |
| GST Item Wise Sales Report | `iwgstrep` | 🟢 `IWGSTREP.PRG` | `/reports` → gst | 3 |
| Cashier Wise Sales Report | `cwr` | 🟡 CWR | `/reports` → sales-cashier | 3 |
| BillWise Sales Report (cash/credit/all/debtors/cash-credit/kerosene) | `cbs`/`rbs`/`abr`/`drrep`/`ccr`/`kbs` | 🟡 CBS/RBS/DRREP/CCR/KBS | `/reports` → bills (bill register, filterable by status) covers cash/credit/all; debtors specifically maps to the Dashboard's "top customer dues"; **no kerosene-specific bill type is modeled** (kerosene is just an item like any other in the modern schema) | 3/4 |
| Stock Reports (+ Closing Stock Valuation) | `stkanyrp`/`clval` | 🟡 SAR/CLVAL | `/reports` → stock | 3 |
| Purchase Report (item/invoice-wise) | `pur_rep`/`purinvws` | 🟡 PWR/INVPWR | `/reports` → purchases | 3 |
| Customer's Sales Statement | `cws` | 🟡 CWS family (largest report cluster in the legacy app — many variants) | `/customers` ledger view | 3 |
| Customer MileAge Statement | `magerep` | ⚪ | Not a direct match — modern mileage is per-**vehicle**, not per-customer (`/reports` → mileage) | 3 |
| Customer Receipts | `rec_rep` | 🟡 REC_REP | Receipts are recorded (`POST /receipts`) but have **no dedicated report/list view** beyond what a per-customer ledger entry shows | 2/3 |
| Customer Ledger | `displedg` | 🟡 LEDGER/DISPLEDG | `/reports` → customer ledger (computed on the fly, not a stored table — see `Project_Status.md`) | 3 |
| Vehicle Sales Report | `vws` | 🟡 VWS | `/reports` → vehicles | 3 |
| Vehicle MileAge Report / Fleet Card Report | `vwsmage`/`dfltRep` | 🟡 VWSMAGE | `/reports` → mileage, `/reports` → fleet-cards | 3 |

### Tax Reports

| Legacy menu item | Legacy target | Source | Modern feature | Phase |
| --- | --- | --- | --- | --- |
| Daily/Periodic/Yearly Tax & GST reports (6 menu items) | `itemrepv`/`rep_dvs`/`rep_mvs`/`rep_yvr`/`rep_dgst`/`rep_gst` | 🟡 DVS/PVS/YVS/DWVS family | `/reports` → gst, with day/month/year granularity + Excel export — one flexible report replaces six fixed legacy ones | 3 |

### Utilities

| Legacy menu item | Legacy target | Source | Modern feature | Phase |
| --- | --- | --- | --- | --- |
| Backup | `backup` | 🟢 `BACKUP.PRG` (zips DBFs to a removable drive) | `/settings` → Backup & Restore, `POST /backup` (SQLite `VACUUM INTO`, not a zip) | 4 |
| Restore | `restore` | ⚪ | `/settings` → Backup & Restore, `POST /backup/restore` | 4 |
| Refresh Bills (member=2 hidden) | `refresh` | ⚪ | **Not built** — unclear what this did without source; possibly a stock/total recalculation utility | — |
| Settings | `settings` | ⚪ | `/settings` → Company Profile only covers the letterhead fields; the legacy `SETTINGS.DBF` also held flags like `KEROSENE`, `FLEETCARDENTRY`, `PRINTTESTMODE` which have **no modern equivalent config screen** | 3 |
| Password (member=2 hidden) | `grpass` | ⚪ | **Not built** — no password-policy/reset admin screen; users change nothing beyond logging in | — |
| Print Header | `header` | 🟢 `HEADER.PRG` | Folded into the invoice PDF letterhead (`services/invoicePdf.ts` + `/settings` Company Profile), not a separate print action | 3 |
| Calculator (F8) | `calc` | ⚪ | Not applicable — browser has none built in; not reimplemented |  |
| Change User | `chguser` | ⚪ | Standard logout/login (`NavBar` sign-out) | 1 |
| Change Financial Year | `setfinyr` | ⚪ | `/settings` → Financial Year | 4 |
| Transfer Data (current month / entire / rate changes) | `transdat`/`tranedat`/`tranrate` | ⚪ (`CURDATA.PRG` survives but doesn't match the menu's call target — see below) | **Not applicable** — this was about copying DBFs between physical drives/sites in a DOS environment; nothing to port | — |
| Bulk Tax% Change | `taxChang` | ⚪ | `/settings` → Bulk Tax Change, `POST /items/bulk-tax-change` | 4 |

### Search

| Legacy menu item | Legacy target | Source | Modern feature | Phase |
| --- | --- | --- | --- | --- |
| BY VEHICLE | `vehsrch` | ⚪ | No dedicated vehicle search screen; vehicle lookups happen implicitly via mileage/vehicle reports | — |
| Edit Bill Details (member=2 hidden) | `editcust` (bar prompt/target mismatch in the source itself) | ⚪ | `/billing` bill lookup | 2 |
| Edit CustomerWise VEH Details | `cw_veh_d` | ⚪ | **Not built** — no screen to reassign a vehicle's owning customer after creation | — |
| Edit Order No. of CreditBills | `editref` | ⚪ | **Not built** — the legacy `ONO` (credit-bill order number) field isn't modeled in the modern schema at all | — |
| View/Del Rate Change | `vwratesc` | ⚪ | `/rate-changes` (view only — no delete; a scheduled-but-wrong rate change can't currently be retracted) | 2/4 |
| Cancelled Bills | `bcncrep` | ⚪ | `/reports` → bills, filter `status=cancelled` | 2/3 |
| Edit Customer Opening Balance | `ed_OpBal` | ⚪ | `/customers` → Set Opening Balance | 2 |
| Edit Customer Current Balance | `ed_ClBal` | ⚪ | No direct equivalent — `due_amount` only changes via bills/receipts/opening-balance, never a raw manual edit | — |

## Notable non-feature findings from the legacy source

Worth knowing even though none of it maps to a modern feature:

- **Multi-dealer white-label deployment.** `SA.PRG` (Srinivasa Agencies — the real dealer this repo's
  demo data is drawn from), `SKK.PRG`, `SKLS.PRG` (plus `ASSGNHDR.BAK`, `HEADINGS.BAK`) each hardcode
  a different fuel dealership's letterhead text (Indian Oil, Bharat Petroleum, HP dealers by name) —
  the same codebase was deployed to at least three different petrol pumps. PetroPro's `tenants` table
  (Session 13, formerly `company_profile`) covers the same need generically — one row per deployment
  (one SQLite database per customer), seeded from `HEADINGS.DBF`/`SETTINGS.DBF` by
  `dbf/import.ts`'s `importTenant()` — instead of one hardcoded `.PRG` per site.
- **A licensing/trial-period gate.** `ENCRYPT.PRG`/`ENCWKEY.PRG`/`XORSHIFT.PRG`/`ASCOFBIN.PRG` form
  an obfuscation chain (not real cryptography) that decodes a dealer header record and appears to
  enforce a trial-period expiry inside `MAINMENU.PRG`. Not relevant to a modern rebuild, but
  explains why some header/config values in the legacy DBFs look encoded.
- **A hidden developer console.** `MAINMENU.PRG` binds F12 + a hardcoded password
  (`"KissMeDear"`) to a function (`onlyformurali`) that runs arbitrary FoxPro commands live against
  the production data. Mentioned here only as an artifact of the original codebase's era, not as
  something to replicate.
- **Duplicate confirmation-dialog code.** `CONFIRM.PRG`, `CONFIRMB.PRG`, `CONDS.PRG`, `BKUPCON.PRG`,
  `REPCONF.PRG` are all near-identical "Are you sure?" dialogs with slightly different hardcoded
  text — `CONFMSG.PRG` is the one parameterized version that could have replaced all of them. Just
  a code-smell note from the reverse-engineering, not something requiring a modern equivalent.
- **Dead/superseded code confirmed by direct inspection**, not carried into any modern feature:
  `TEMP.PRG` (an alternate, simpler `backup` implementation that FoxPro's filename resolution would
  never actually reach), `ITEMWISE.PRG` (misleadingly named — its content is a one-line destructive
  `DELETE FOR bill_date != {08/08/2000}`, not a report), `CURDATA.PRG` (content matches "Transfer
  Data → Current Month Data" but the menu calls a `transdat` that doesn't exist as a file — likely
  an earlier draft), `SCAFFOLD.PRG` (an abandoned FoxApp-wizard prototype referencing files that
  don't exist in this tree), plus assorted one-off dev/debug query scripts (`TEST.PRG`,
  `TESTNUM.PRG`, `TST.PRG`, `IQ.PRG`, `QRYSTKTS.PRG`, `SALETST.PRG`, `VATREPOR.PRG`, `PRGTEST.PRG`,
  `SAMPLE.PRG`) and two site-specific one-time schema-migration patches (`VATPATC.PRG`/`VATPATI.PRG`,
  adding tax columns for two different physical drive letters/sites).
- **`MONEY.PRG`** is the direct legacy source for the amount-in-words function already ported
  byte-for-byte (down to preserving its "Fourty" spelling) in `apps/api/src/services/money.ts` —
  see `docs/ROADMAP.md` Phase 1 and `apps/api/src/services/money.test.ts`.

## Report layouts (`.FRX`/`.FRT`) by category

66 `.FRX` files (one orphan, `IWR112.FRX`, has no matching `.FRT`). Grouped by naming convention —
several groupings below are inferred from filename patterns and partially confirmed against the
menu mapping above; treat uncertain ones as a starting point for investigation, not fact:

- **Bill/invoice printing:** `BILL`, `ALLBILL`, `BILLREPR`
- **Cash/credit/kerosene bill summaries:** `CBS`, `RBS`, `KBS`, `CCR`, `DRREP`
- **Customer-wise statement (CWS)** — the largest cluster, many grouped/vehicle/monthly/
  screen-preview variants: `CWS`, `CWS-P`, `CWS2`, `CWSNEW`, `CWSG`, `CWSGWO`, `CWSVWB`, `CWSWO`,
  `CNCWS`, `WOCWS`, `GRPCWS`, `GRPCWSWO`, `GRPMCWS`, `MCWS`, `SCN-CWS`, `SCNCWSWO`, `SCNMCWS`,
  `SCNMGCWS`, `SCN-GCWS`, `SCNGWSWO`
- **Cashier-wise / customer-vehicle ledgers:** `CWR`, `CUSTVEBK`, `CUST_VE`, `ITEM_VE`
- **Ledgers/receipts/statements:** `LEDGER`, `DISPLEDG`, `DWSLEDG`, `MWSLEDG`, `MWSLEDGE`, `REC_REP`
- **Stock reports:** `CLSTK`, `CLVAL`, `SAR`
- **Item-wise sales (IWR family):** `IWR11`, `IWR11V`, `IWR112` (orphan), `IWR12`, `IWRTEST`,
  `PIWR`, `YIWR`, `GIWR`, `MIWR`
- **Purchase reports:** `PWR`, `GPWR`, `INVPWR`
- **VAT/GST/Tax reports:** `DVS`, `DWVS`, `DWVS1`, `MWVS`, `PVS`, `YVS`, `FBS`, `DWSSALRP`,
  `EXP_REP`
- **Vehicle/mileage:** `VWS`, `VWSMAGE`
- **Uncategorized:** `GRPRBS`

## Genuine gaps this mapping surfaces

Cross-referencing the legacy menu against what's actually built surfaces gaps not previously called
out this precisely in `Project_Status.md` / `Todo.md`:

- No user-management API/UI at all (create/edit/deactivate cashiers/attendants) — users only ever
  come from `db/seed.ts` or the DBF importer.
- No receipt print/PDF output (bills have one; receipts don't).
- No admin UI for groups/items (API-only) — see `Todo.md`.
- No way to delete/retract a scheduled rate change once created.
- No settings screen for the old `SETTINGS.DBF`-style operational flags (kerosene handling,
  fleet-card entry toggle, print test mode) — only the company-profile letterhead has a screen.
