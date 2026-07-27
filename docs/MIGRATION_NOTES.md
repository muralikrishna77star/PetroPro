# PetroPro — Migration Notes

How real legacy data moves from `legacy/Workarea/*.DBF` into the modern SQLite schema, and the
rules/gotchas discovered while building and testing the importer (`apps/api/src/dbf/`).

## Running it

```powershell
cd apps/api
npm run import:legacy                    # defaults to ../../legacy/Workarea
npm run import:legacy -- /path/to/dbfs   # or point at a different directory
```

Safe to re-run: every table is imported by natural key (group code, item code, customer code,
vehicle no., user id) and existing rows are skipped, not duplicated or overwritten.

## What's imported

| Legacy table | Modern table | Notes |
| --- | --- | --- |
| `GROUP.DBF` | `groups` | Direct field mapping. |
| `ITEM.DBF` | `items` | `MAGE` (`Y`/`N`) → `track_mileage` boolean. `group_code` is dropped to `null` if it doesn't match an imported group (defensive FK check, not an error). |
| `CUSTOMER.DBF` | `customers` | Direct field mapping; `PHONE` (numeric in legacy) becomes a string. |
| `VEH_DET.DBF` | `vehicles` + `fleet_cards` | See "Fleet cards" below. |
| `USERTAB.DBF` | `users` | See "Passwords" below. |

**Not imported:**
- `FLEETCARD.DBF` — see "Fleet cards" below for why.
- The full transactional history (`<MON>BIL<YY>`, `<MON>STK<YY>`, `PURCH<YY>`, `RECPT<YY>`, etc.,
  across every fiscal year in `legacy/Workarea/`) is still **not** migrated by `import.ts` — only
  master data (catalog, customers, vehicles, users). Decades of monthly transaction tables across
  fiscal years is a materially bigger effort than this pass covered (each month/year is a separate
  physical DBF file with its own consolidation logic — see `docs/DATA_DICTIONARY.md` section 4).
  If this is needed later, `apps/api/src/dbf/reader.ts` (the binary DBF parser) already handles the
  record format; it's the per-table consolidation logic that would need building.
- **A fixed 3-month demo window is imported separately** — see "Demo transaction window" below.
  This is a scoped, one-off complement to `import.ts`, not a step toward the full historical
  migration above.
- **A full fiscal year (2025-04-01 → business date) is imported separately too** — see "FY2025-26
  full-year migration" below. Also a scoped complement, not a general historical importer.

## Demo transaction window (`import:demo-transactions`)

```powershell
cd apps/api
npm run import:demo-transactions          # defaults to ../../legacy/Workarea
npm run import:demo-transactions -- /path/to/dbfs
```

Run `import:legacy` (master data) first — this depends on groups/items/customers/vehicles/users
already existing so it can validate foreign keys. Safe to re-run: it's a single run-once guard
(skips entirely if any bill already exists dated in the window below), not per-row natural keys.

Imports the most recent 3 consecutive real months of transactional data that actually exist in
`legacy/Workarea/` — **2019-04-01 through 2019-06-15/16**, confirmed by reading actual
`BILL_DATE`/`SDATE`/`PUR_DATE` values out of the DBFs (filename year suffixes aren't reliably
chronological — e.g. `MARBIL02.DBF` also exists alongside `MARBIL18.DBF`). Source: `APRBIL19.DBF`,
`MAYBIL19.DBF`, `JUNBIL19.DBF` (bills), matching `*STK19.DBF` (stock day-book), `PURCH19.DBF`
(purchases), `MAGE19.DBF` (mileage). Dates are kept exactly as recorded — not shifted to look
"current" (a deliberate choice: see `AI_Handoff.md` Session 11).

**`BILL_NO` is not a reliable per-bill key — a real bug this importer had to work around.**
`BILL_NO` repeats within a single monthly file for completely unrelated transactions (confirmed
against the actual data: `APRBIL19.DBF`'s `BILL_NO=1` covers one 00:28 retail fuel sale to a named
vehicle/customer, *and* a totally unrelated 22:19 multi-item entry with no vehicle or customer).
`BTIME` is stamped identically across every line of one real transaction and differs between
distinct ones, so the importer groups by `(BILL_NO, BTIME)`, not `BILL_NO` alone. Grouping by
`BILL_NO` alone was tried first and silently merged unrelated transactions into single
million-rupee bills — caught by spot-checking the imported data against the source rows before
calling this done.

**Not imported in this window:**
- `BILLCNCS.DBF` (cancelled bills) — that table lacks `RATE`/`RATEBTX`/`TAX_PER`/`TAX_AMT`, so
  reconstructing cancelled bill_lines would mean inferring tax figures never actually recorded.
  Deliberately skipped rather than fabricated.
- `RECPT19.DBF` (receipts) — the real dataset has **zero** receipt rows in this window. Nothing to
  import; not a bug.

**A characteristic of the real data worth knowing before presenting a demo off this import:** a
recurring pattern of large (some 7-figure ₹) bills with `vehicle_no = '-'` and no customer appears
throughout the window (e.g. bill totaling ~₹10 lakh at 2019-04-01 22:19, ~₹10.25 lakh on
2019-04-04). These look like day-end bulk stock-adjustment or depot-transfer entries that the
legacy system recorded through the same bill mechanism as customer sales — this is genuinely
present in the source data, not an import artifact, but it means "largest bills" sorts in the demo
will surface these rather than a customer's largest fuel purchase.

**Known consequence, not a bug:** `customers.due_amount` (imported by `import.ts` from the current
master `CUSTOMER.DBF` snapshot) is **not** adjusted by these historical credit bills — it already
reflects a real point-in-time balance from years after this window, and retroactively stacking
3 months of 2019 credit-bill totals onto it would double-count against activity that isn't in this
repo. A credit customer's "Due" figure on `/customers` and their `/reports/customers/:code/ledger`
balance for just this window will not reconcile — expected, given only a snapshot + one 3-month
slice of history exist, not the years of activity between them.

## FY2025-26 full-year migration (`import:fy2025`)

```powershell
cd apps/api
npm run import:legacy -- /path/to/dbfs    # master data first — see below
npm run import:fy2025 -- /path/to/dbfs
```

Migrates **2025-04-01 through the legacy system's own "business date"**
(`DATESTAT.DBF`'s `DATEHLD` field in the target folder, read dynamically — not hardcoded, so a
later re-run against an updated folder/DATESTAT picks up new months automatically). Source: real
data supplied at `WorkareaTill29Mar2026\` (`DATEHLD` = 2026-03-29 there). Unlike the 3-month demo
window above, this spans up to 12 monthly bill/stock files and is **idempotent per month**
(checked against each month's actual `BILL_DATE` range in `bills`), not one all-or-nothing guard
— safe to re-run repeatedly, e.g. as new months land in the source folder.

**Run `import:legacy` (master data) against the same folder first.** Credit bills resolve
`customer_code` by checking the customer already exists; skip this step and every credit bill in
the window silently imports as `cash` instead.

**Filenames use a plain calendar-year suffix for bills/stock — confirmed by reading actual
`BILL_DATE`/`SDATE` values, not assumed.** `JANBIL26.DBF` really is January 2026, `FEBBIL25.DBF`
really is February 2025 — no fiscal-year offset, unlike `BILSEK`/`MAGE` below. The importer
builds `<MON><YY>BIL/STK<YY>.DBF` filenames by walking the window month-by-month rather than
hardcoding a file list, so it naturally builds `NOVBIL25.DBF`.

**`ANOVBIL25.DBF` is a stale partial duplicate of `NOVBIL25.DBF`, not a distinct file to import.**
Same first row, but only 2,777 of `NOVBIL25.DBF`'s 4,735 rows — a mid-month snapshot left in the
folder. The importer never references it (the generated filename is always `NOVBIL25.DBF`); if a
future source folder has a similarly-prefixed variant for another month, check row counts/content
against the plain-named file before trusting it.

**Mileage matching needed a second index table (`BILSEK25.DBF`) the 3-month demo window never
needed.** `MAGE25.DBF` (`BILL_NO, STATUS, VEH_NO, ICODE, OR, CR, MILEAGE`) has no date field.
Initial assumption — that `BILL_NO` resets every month like it appeared to in the 2019 window —
was wrong and would have risked matching a mileage row to the wrong month's bill. The real
structure, confirmed by reading `BILSEK25.DBF` (`MONTH, MINBILLNO, MAXBILLNO, STATUS` — 46 rows):
`BILL_NO` is a **year-wide counter split into two independent sequences by `STATUS`** (`'C'` and
`'R'`), and `BILSEK25.DBF` is the legacy system's own lookup index mapping a `(STATUS, BILL_NO)`
pair to exactly one calendar month (e.g. `MONTH=4, STATUS='C', MINBILLNO=1, MAXBILLNO=3061` →
April's `'C'`-sequence bills). One `BILSEK25.DBF` covers the whole fiscal year — its `MONTH`
values 1/2/3 mean Jan/Feb/Mar **2026**, at the tail of the FY, not the start. No `BILSEK26.DBF`
exists or is needed. `importFY2025.ts` routes each `MAGE25.DBF` row to its month via this table,
then matches `(BILL_NO, STATUS, VEH_NO, ICODE)` against that month's already-imported bill
candidates — the same composite-key approach `importTransactions.ts` uses, just correctly scoped
to one month first instead of assuming a single month. Rows with a null `MONTH` in `BILSEK25.DBF`
are a separate running-total table, not per-month ranges — skipped.
Result on the real dataset: 11,716 of 11,824 mileage rows matched (99.1%) — the rest are accepted
as normal data noise (see "Data quality" below), not investigated further.

**`STATUS` (`'C'`/`'R'`) on bill rows is *not* payment type — a real trap.** A sample row had
`STATUS='C'` with a blank `CUST_CODE`; `BILSEK`'s `'C'`/`'R'` split sizes don't line up with
credit-vs-cash bill counts either. It's almost certainly which of the two `BILSEK` counters
assigned that `BILL_NO`. `payment_type` is still derived the existing way (customer_code present
→ credit); `STATUS` is only used as part of the mileage-matching key above.

**Purchases/receipts are nearly empty in this window** — `PURCH25.DBF`/`PURCH26.DBF`: 0 rows.
`RECPT25.DBF`: exactly 1 row. Imported anyway (cheap), same "not a bug" precedent as the demo
window's zero-receipts finding. `RECPT25.DBF`'s `AMOUNT`/`SC_AMT`/`CSR_INIT` fields are inserted
directly (not via `receiptsRepo`, whose `ReceiptInput` requires a non-null `cashier_id` — the one
real row's `CSR_INIT` is blank).

**A known limitation of the per-month idempotency guard**: mileage candidates are only built for
months freshly imported *in the current run* — a month already imported by a prior run won't get
mileage (re-)matched on a later run even if `MAGE25.DBF` changes. Fine for a one-off migration
run start-to-finish, worth revisiting if this ever becomes a recurring incremental job.

## Passwords are NOT migrated

`USERTAB.PWD` holds a legacy value (observed as short plaintext-looking numeric strings, e.g.
`"141411"`) — it is **not** a bcrypt hash and cannot be imported as one. Every migrated user
instead gets the same temporary password (`changeme123`, set in `import.ts`) and must have it
reset before real use. This is a deliberate security decision, not an oversight — do not "fix" it
by trying to convert or reuse the legacy value.

## Role mapping is a judgment call

`docs/DATA_DICTIONARY.md` documents `USERTAB.LEVEL`: 1 = admin/manager, 2 = cashier, with the
legacy app hiding admin menu bars via `skip for member=2`. The real data in this repo's
`legacy/Workarea/USERTAB.DBF` has **every user at LEVEL 0** — not 1. Since the only level the
legacy app treats specially is 2 (per that `skip for member=2` check), the importer maps
**LEVEL = 2 → `cashier`, everything else (0, 1, or any other value) → `admin`**. If your legacy
data has real level-2 cashier accounts, they'll import correctly; if the actual FoxPro source used
LEVEL differently, revisit `importUsers()` in `apps/api/src/dbf/import.ts`.

## Fleet cards: a schema mismatch, resolved by assumption

The modern `fleet_cards` table has `card_no` as its primary key (a distinct card identifier). But
neither legacy table actually carries one:
- `VEH_DET.DBF` has a `FLEETCARD` field (free text) on each vehicle row.
- `FLEETCARD.DBF` has only `(CUST_CODE, VEH_NO)` — a subset of the same association, no card
  number of its own.

The importer treats `VEH_DET.FLEETCARD`'s text value **as** the card number: one `fleet_cards` row
per distinct non-blank value, `customer_code` taken from the first vehicle that references it.
`FLEETCARD.DBF` is not imported separately — it can't populate a `card_no` that doesn't exist in
its own records, and everything it encodes is already present in `VEH_DET`. **This is an assumption
about intent, not a documented business rule** — the original FoxPro program logic behind these two
tables isn't fully captured in `docs/DATA_DICTIONARY.md`. Revisit if it turns out fleet cards had
real card numbers tracked somewhere else in the legacy system.

## Data quality: the importer does not clean business data

Real legacy data has gaps and noise — confirmed against the actual files in this repo:
- `VEH_DET.DBF` (109,282 rows) contains obviously-invalid vehicle numbers (test/garbage entries
  like `"ADFAF-AAFA"`) alongside real ones. These import as-is; the importer's job is structural
  validity (a non-blank primary key), not judging whether a value looks legitimate.
- Some vehicles reference a `CUST_CODE` that doesn't exist in `CUSTOMER.DBF` (e.g. a real vehicle
  in this dataset references `"MKKLS"`, which isn't a customer on file — plausibly a purged
  customer record with a lingering vehicle reference). The importer checks the customer actually
  exists before setting the FK and leaves it `null` rather than violating the foreign key or
  fabricating a customer record.
- `FLEETCARD.DBF` has rows with a blank `CUST_CODE` or malformed vehicle numbers (e.g. `"C-"`) —
  moot here since that table isn't imported, but the same defensive pattern (check before
  assigning a FK) is used everywhere the importer does assign one.

Row counts are reported per table when the import runs (`imported` / `already present` /
`invalid`, out of total DBF rows) — treat a large `invalid` count as a signal to look at the source
data, not a bug in the importer.

## Verified against real data

This importer was tested against the actual files in `legacy/Workarea/` (not synthetic fixtures):
8 groups, 69 items, 74 customers, 109,282 vehicle records, 2,688 fleet-card records, and 11 users —
completing in about 15 seconds. See `AI_Handoff.md`'s Phase 5 session log for the specific
verification steps (spot-checked imported records via the API, confirmed a migrated user can log
in with the temporary password, confirmed the FK-fallback behavior on the real "MKKLS" gap above).
