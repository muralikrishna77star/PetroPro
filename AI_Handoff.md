# AI_Handoff.md

Read this file first, every session. It is the entry point for continuing PetroPro development.

## Session protocol

1. Read all documentation under `/docs`.
2. Read this file (`AI_Handoff.md`) first.
3. Read `Project_Status.md`.
4. Read `Todo.md`.
5. Continue exactly from the last completed task — do not restart or reorder work.
6. Do not rewrite existing modules unless necessary (note *why* here if you do).
7. Follow the established architecture and coding standards (see [CLAUDE.md](CLAUDE.md)).
8. Before ending the session: update `AI_Handoff.md` (this file) and `Project_Status.md`.

## Where the source of truth lives

| Topic | File |
| --- | --- |
| Phase plan | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Legacy → modern schema mapping | [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md) |
| Entity relationships | [docs/ER_DIAGRAM.md](docs/ER_DIAGRAM.md) |
| Repo conventions / architecture for AI agents | [CLAUDE.md](CLAUDE.md) |
| Original product brief | [PetroPro_Claude_Master_Prompt.pdf](PetroPro_Claude_Master_Prompt.pdf) |
| Legacy source (read-only reference) | `legacy/Workarea/` |

`docs/MODULES.md` and `docs/MIGRATION_NOTES.md` are referenced by `README.md` and now both exist
(written in Sessions 8 and 7 respectively).

---

## Handoff log

### 2026-07-12 — Session 1 (bootstrap)

**Last completed task:** Phase 0 (reverse engineering) — data dictionary, ER diagram, roadmap,
`legacy/dbf_schema.py` tooling, and root `CLAUDE.md` for AI-agent context. No application code
(`apps/api`, `apps/web`) exists yet.

**State:** `package.json` declares npm workspaces for `apps/*` and `packages/*`, but neither directory
exists on disk yet — `npm install` / `npm run dev:*` will fail until Phase 1 scaffolding lands.

**Next task:** Start Phase 1 per `docs/ROADMAP.md`:
1. Scaffold `apps/api` (Fastify + TypeScript) and `apps/web` (Next.js + TypeScript + Tailwind) as npm
   workspaces.
2. SQLite schema + repository layer + seed script (seed creates the `admin`/`admin123` login named in
   `README.md`).
3. Backend: auth (users/roles/JWT), groups, items, customers, vehicles.
4. Tax engine (GST inclusive/exclusive) + Indian amount-in-words `money()` port (legacy PRG reference
   TBD — search `legacy/Workarea/*.PRG` for the original routine before reimplementing from scratch).
5. Headline vertical slice: attendant entry → cashier pending queue → invoice.
6. Web PWA shell: installable app-shell, login, attendant screen, cashier screen.

**Notes for the next session:** none yet — this is the first implementation session.

### 2026-07-12 — Session 2 (Phase 1 implementation)

**Last completed task:** Phase 1 (Foundation & core domain) — complete, per `docs/ROADMAP.md`
(marked ✅). Built and verified end-to-end:
- `apps/api`: Fastify + TypeScript, SQLite via Node's built-in `node:sqlite` (`DatabaseSync` — chosen
  over `better-sqlite3` specifically to avoid a native-module build step; see
  `Project_Status.md` open questions for the Node-version implication).
- Repository layer + schema for groups/items/customers/vehicles/fleet_cards/users/bills/bill_lines/
  pending_transactions.
- Auth (JWT + bcryptjs), role-gated routes (admin/manager/cashier/attendant).
- Tax engine (`services/tax.ts`) matching legacy `*BTX`/`*TAX` field pairs.
- `services/money.ts` — faithful port of `legacy/Workarea/MONEY.PRG` (found by grepping legacy PRGs
  for `money(`), including the legacy "Fourty" spelling, kept intentionally for output parity.
- Vertical slice (`services/billing.ts`): attendant `POST /pending-transactions` → cashier
  `GET /pending-transactions` (queue) → `POST /bills/settle` → `bills`/`bill_lines` + amount-in-words.
- `apps/web`: Next.js App Router + Tailwind PWA — login, attendant entry, cashier queue/settlement
  screens; installable app-shell (`manifest.json`, `sw.js`, generated placeholder icons).

**Verification performed this session:** `tsc`/`eslint`/production build clean in both workspaces;
both dev servers started together (API on 4000, web on 3100 — 3000 was taken by an unrelated local
project); full HTTP-driven walkthrough of login (attendant + cashier) → pending entry → queue →
settle → invoice, confirming tax split and amount-in-words output; confirmed CORS allows the web
origin to call the API. **Not verified:** actual browser/UI interaction (no browser automation tool
available in this session) — screens were exercised via curl against the API and via `next build`/
`next dev` HTTP checks only, not clicked through visually. Recommend a manual click-through before
treating the UI itself as validated.

**State:** all dev/background processes were stopped at end of session — nothing left running.
`apps/api/data/petropro.db` exists locally (gitignored) from the seed run; delete and re-run
`npm run seed` for a clean slate.

**Next task:** Start Phase 2 (Billing & inventory) per `docs/ROADMAP.md` / `Todo.md`'s "Next up"
section: full walk-in bill entry (cash/credit/retail) not gated behind a pending transaction, cancel-
bill flow (legacy `BILLCNCS`), stock day-book, purchases, scheduled rate changes.

**Notes for the next session:**
- `docs/MODULES.md` and `docs/MIGRATION_NOTES.md` are still unwritten (referenced by `README.md`).
- No test suite exists yet for `apps/api` despite the `npm test` script being wired up — worth adding
  alongside Phase 2 rather than deferring further.
- No admin UI (groups/items/customers/vehicles) — only REST CRUD. Not a Phase 1 requirement, but will
  likely be needed once Phase 2 introduces purchases/rate changes that need master-data upkeep.

### 2026-07-12 — Session 3 (Phase 2 implementation)

**Last completed task:** Phase 2 (Billing & inventory) — complete, per `docs/ROADMAP.md`
(marked ✅). Built and verified end-to-end, entirely backend/API (no web UI this session — see
`Project_Status.md` gaps):
- Schema: `stock_daybook`, `purchases`, `rate_changes`, `opening_balances`, `receipts` tables, plus
  `cancelled_by`/`cancelled_at` added to the existing `bills` table via a new `ensureColumn` helper
  in `db/schema.ts` (SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`).
- `services/billing.ts`: `createWalkInBill` (direct cashier billing, cash/credit/retail, credit-limit
  enforcement) and `cancelBill` (legacy BILLCNCS — reverses stock + credit due-amount, audit trail).
- `repositories/stock.ts`: stock day-book with automatic opening→closing rollforward per item/day;
  `applySale`/`applyReceipt`/`reverseSale`/`closeDay`.
- `services/purchasing.ts`: purchase entry feeds stock receipts + rolls the item's last purchase
  cost (`items.purchase_value`) forward.
- `services/rateChanges.ts`: scheduled rate changes (legacy RATECHG/SCHED_ON) with an
  `apply-due` endpoint (manually triggered — no background scheduler exists).
- `services/customerAccounts.ts`: receipts (payment reduces `due_amount`) and opening balances
  (legacy OP_BAL — one-time due-amount baseline, overwrites not adds).
- New routes: `POST /bills` (walk-in), `POST /bills/:billNo/cancel`, `GET /bills/last`,
  `GET|POST /stock`, `POST /stock/close`, `GET|POST /purchases`, `GET|POST /rate-changes`,
  `POST /rate-changes/apply-due`, `GET|POST /receipts`, `POST /customers/:code/opening-balance`.

**Verification performed this session:** `tsc` clean. Critically, ran the API against the
**pre-existing Phase 1 dev database** (not a fresh one) to prove the `ensureColumn`/
`CREATE TABLE IF NOT EXISTS` migration path works on already-populated data — this is the real
test of the no-formal-migrations approach. Then walked the full chain over HTTP: walk-in cash bill →
stock day-book shows the sale → purchase entry → stock day-book shows the receipt + item
`purchase_value` rolled to the computed unit cost → cancel the bill → stock reverses exactly → double-
cancel rejected (400) → create credit customer → set opening balance → credit bill → due_amount
correct → receipt → due_amount reduced → schedule a past-dated rate change → apply-due → item retail
price updated → oversized credit bill rejected for exceeding credit limit → last-bill lookup by
customer_code → stock/close flips the `closed` flag → non-admin role correctly blocked (403) from
`/purchases`. **Not verified:** no web UI was built for any of this, so nothing to click through —
purely an API-level session.

**State:** dev DB was reset to a clean seed (`rm data/petropro.db && npm run seed`) at end of session.
All dev processes stopped — nothing left running.

**Next task:** Start Phase 3 (Reports & tax) per `docs/ROADMAP.md` / `Todo.md`'s "Next up" section:
sales reports (item/cashier/bill/group-wise), stock/purchase/customer-statement reports, a real
customer ledger roll-up (`ledger_entries` doesn't exist yet — only the raw tables it would summarize
do), mileage/vehicle/fleet-card reports, VAT/GST summaries, and PDF/Excel output (this is also where
actual print-formatted invoice/duplicate-bill output belongs — Phase 2's `/bills/last` only returns
JSON).

**Notes for the next session:**
- Still no web UI for Phase 2 features (purchases, rate changes, receipts, cancel, walk-in billing).
  Worth deciding whether Phase 3 should backfill a cashier "walk-in bill" screen alongside reports, or
  keep punting UI work — flag to the user rather than assuming.
- `docs/MODULES.md` and `docs/MIGRATION_NOTES.md` are still unwritten.
- Still no test suite for `apps/api`.
- See `Project_Status.md` "Known gaps" for the stock-day-close non-enforcement, receipts
  `service_charge` ambiguity, and opening-balance overwrite-not-additive behavior — none are
  blockers, but a future session should know they're deliberate simplifications, not oversights.

### 2026-07-12 — Session 4 (Phase 3 implementation)

**Last completed task:** Phase 3 (Reports & tax) — complete, per `docs/ROADMAP.md` (marked ✅).
Built and verified end-to-end, entirely backend/API (no web UI — see `Project_Status.md` gaps):
- `repositories/reports.ts`: sales by item/cashier/group (day/month/year granularity via SQLite
  `strftime`), bill register, vehicle-wise and fleet-card-wise sales, GST summary.
- `services/ledger.ts`: customer ledger/statement computed on the fly from opening_balances +
  credit bills + receipts (deliberately *not* a stored `ledger_entries` table — avoids keeping two
  copies of the same facts in sync; see `db/schema.ts` comment).
- New `mileage_log` table + `repositories/mileage.ts`: computes km-per-unit mileage from
  consecutive odometer readings per vehicle (legacy MAGE table's OR/CR/MILEAGE). Wired into both
  `settlePendingTransaction` and `createWalkInBill` in `services/billing.ts` — the latter gained an
  optional `odometer` field per line to make walk-in fuel sales symmetric with the attendant path.
- New `company_profile` table (single row) for the invoice letterhead + `GET|PUT /company-profile`.
- `services/invoicePdf.ts` (pdfkit) — `GET /bills/:billNo/pdf`, print-ready A5 invoice.
- `services/gstExcel.ts` (exceljs) — `GET /reports/gst.xlsx`, real .xlsx workbook.
- New deps: `pdfkit`, `@types/pdfkit`, `exceljs`.
- All new routes registered in `routes/reports.ts` and `routes/companyProfile.ts`, gated
  `admin`/`manager` only (reports aren't cashier/attendant-visible).

**Bug found and fixed during verification:** date-range filters using raw SQL `BETWEEN from AND to`
against `bills.bill_date`/`purchases.pur_date` silently excluded *today's* rows whenever `to` was a
bare date string — because those columns store full `datetime('now')` timestamps
("2026-07-12 08:26:27"), which sort *after* the bare date "2026-07-12" in SQLite's text comparison.
Fixed by wrapping every such comparison in SQL `date(column)`, and by normalizing to the date
portion (`.slice(0, 10)`) before comparing in `services/ledger.ts`'s in-app filtering. **This is a
sharp edge for future work** — any new date-range query over `bills`/`purchases` must follow the
same pattern (`stock_daybook.sdate` is already date-only, so it doesn't need this).

**Verification performed this session:** `tsc` clean. Populated real test data — multi-item walk-in
bills, two sequential attendant fuel entries for the same vehicle specifically to exercise the
mileage math (10,000km→10,300km over 20L = 15 km/L, computed correctly), a purchase, and a credit
customer with an opening balance + a credit bill + a receipt. Hit every new endpoint over HTTP:
sales-by-item/cashier/group, bill register, vehicle sales, mileage, GST summary, stock/purchase range
reports, and the customer ledger — then **downloaded and inspected the actual binary outputs**: the
invoice PDF (read via the Read tool, confirmed correct letterhead/line-items/totals/amount-in-words
after updating `company_profile`) and the GST Excel export (confirmed valid `.xlsx` via `file`).
Cross-checked that the ledger's running balance for the test customer reconciled exactly with
`customers.due_amount` (3188.60 both places). Confirmed attendant role correctly blocked (403) from
`/reports/*`.

**State:** dev DB was reset to a clean seed at end of session. All dev processes stopped.

**Next task:** Start Phase 4 (Offline sync & operations) per `docs/ROADMAP.md` / `Todo.md`'s "Next
up" section: offline IndexedDB queue + LAN sync (`sync_queue` table doesn't exist yet), shift
management, audit logs (`audit_logs` table doesn't exist yet), backup/restore, financial-year switch,
bulk tax change, dashboards (would consume the Phase 3 report endpoints built this session).

**Notes for the next session:**
- Still no web UI for any Phase 2/3 feature. Three sessions in a row have deferred this — worth
  raising with the user explicitly rather than deferring a fourth time, especially since Phase 4's
  "dashboards" item is naturally a UI-heavy phase that will feel awkward to build without first
  having *any* report-viewing UI.
- `docs/MODULES.md` and `docs/MIGRATION_NOTES.md` are still unwritten.
- Still no test suite for `apps/api` — three phases of business logic (tax, money, billing, stock,
  ledger, mileage) now have zero automated regression coverage. This is the biggest risk building up
  across sessions and should be addressed soon, not indefinitely deferred alongside the UI gap.
- Read `Project_Status.md`'s "Known gaps" bullet on date-range queries before writing any new
  date-filtered query — it documents the exact pattern to follow.

### 2026-07-12 — Session 5 (UI backfill for Phases 2–3)

**Context:** at the end of Session 4, three sessions in a row had built backend-only, and I flagged
it explicitly instead of deferring a fourth time. Asked the user to prioritize between web UI and a
test suite; they chose UI first.

**Last completed task:** built a web screen for every Phase 2/3 backend feature that previously had
none — `apps/web` now has `/billing` (walk-in bill entry, cash/credit/retail, bill lookup, cancel,
invoice PDF viewer), `/purchases`, `/rate-changes` (schedule + apply-due), `/customers` (list,
create, per-customer receipt/opening-balance/ledger), `/reports` (one unified viewer covering all 9
report types with date range + granularity controls, plus GST Excel download), and `/settings`
(company profile for the invoice letterhead). Added a shared role-gated `NavBar`
(`components/NavBar.tsx`) and refactored the existing attendant/cashier pages to use it instead of
their own inline headers. Extended `lib/api.ts` with client functions/types for every new endpoint,
plus a `downloadAuthed()` helper — the PDF/xlsx endpoints require a Bearer token, which a plain
`<a href>` can't attach, so it fetches as a blob and hands the browser an object URL instead.

**Bug found and fixed during verification:** `customersRepo.create`/`update`
(`apps/api/src/repositories/customers.ts`) crashed with a 500 (`ERR_INVALID_ARG_TYPE`) whenever
`credit_limit` or `service_charge` was omitted from the request body, because `node:sqlite` throws on
a bound `undefined` rather than silently treating it as null. This bug existed since Phase 1 but had
never been triggered — every prior test (mine and the seed script) happened to pass every field
explicitly. The new Customers page's minimal "add customer" form was the first real caller to omit
them. Fixed with `?? 0` fallbacks, matching the pattern the rest of that file already used. **This is
now called out in `Project_Status.md` as a general rule**: any repository create/update taking
optional fields needs an explicit fallback for every one of them, or it will 500 on a legitimate
partial payload — this class of bug doesn't show up in `tsc`, only when an actual partial request
hits it.

**Verification performed this session:** `tsc`/`eslint`/production build clean in both workspaces
(all 10 web routes compile and return HTTP 200 from a running dev server). Rather than testing the
API in isolation like prior sessions, this time I drove every endpoint using **the exact payload
shapes the frontend actually sends** (which is what surfaced the customers bug — a payload I hadn't
tried before because earlier sessions always filled in every field). Covered: walk-in billing (with
vehicle/customer omitted, as the form allows), bill lookup, cancel, purchases (without `vat_amount`),
rate changes + apply-due, receipts (without `cheque_no`/`bank_name`), opening balance, customer
ledger, company profile, and all 9 report queries with the frontend's exact query-string
construction. Also confirmed a real CORS preflight (`OPTIONS` .../`Access-Control-Request-Headers:
authorization`) succeeds, since the PDF/xlsx downloads are cross-origin fetches with a custom header.
**Not verified:** no browser automation tool was available, so nothing was visually clicked through —
this is still an HTTP-level verification, not a real UI smoke test. Say so explicitly if you pick
this up next and a browser tool becomes available — worth doing before fully trusting the screens.

**State:** dev DB reset to a clean seed at end of session. All dev processes stopped.

**Next task:** Phase 4 (Offline sync & operations) per `docs/ROADMAP.md` / `Todo.md`. The other
flagged gap — no automated test suite — is still outstanding; the user chose UI first when asked,
not UI-instead-of-tests, so it's still owed, not dismissed.

**Notes for the next session:**
- `docs/MODULES.md` and `docs/MIGRATION_NOTES.md` are still unwritten.
- Still no test suite for `apps/api` — now covering tax, money, billing, stock, ledger, mileage,
  *and* customers (which just had a real bug caught only by manual testing, not types) — the case for
  addressing this keeps getting stronger, not weaker.
- No admin CRUD UI for groups/items master data — everything else now has a screen; this is the one
  remaining "backend-only" corner, and it's a much smaller gap than what existed at the start of this
  session.
- `apps/web`'s `/reports` page uses one shared component with a report-type switch, not per-report
  routes — deliberate (see `Project_Status.md`), but means there's no bookmarkable/shareable URL per
  report+filter combination if that's ever wanted.

### 2026-07-12 — Session 6 (Phase 4 implementation)

**Last completed task:** Phase 4 (Offline sync & operations) — complete, per `docs/ROADMAP.md`
(marked ✅). Built and verified end-to-end, backend and frontend both this time (unlike the prior
three sessions):
- **Shifts**: `shifts` table + `services/shifts.ts` — open/close with cash reconciliation. Expected
  cash = opening_cash + cash sales posted by that user since the shift opened; variance = actual -
  expected. Caught and fixed a subtle date-format bug *before* it shipped: the first draft compared
  `shift.opened_at` (SQLite `"YYYY-MM-DD HH:MM:SS"`) against a JS `new Date().toISOString()` upper
  bound (`"YYYY-MM-DDTHH:MM:SS.sssZ"`) — different separator characters sort inconsistently in a
  string `BETWEEN`. Fixed by using SQLite's own `datetime('now')` for the upper bound instead
  (`repositories/shifts.ts`'s `cashSalesSince`), keeping both sides of the comparison in the same
  format. This is the same class of bug flagged in `Project_Status.md` from Session 4, just a new
  occurrence — worth internalizing as a standing rule, not a one-off fix.
- **Audit logs**: `audit_logs` table, hooked into every sensitive mutation (cancel bill, schedule/
  apply rate change, set opening balance, update company profile, bulk tax change, open/close shift,
  create/restore backup) directly at the route layer (not inside services — keeps services pure,
  centralizes "who did this and from where" at the HTTP boundary).
- **Financial year** (`fin_years` table) and **bulk tax change** (`itemsRepo.bulkUpdateTaxPercent`,
  optionally scoped to a group) — both small, both done.
- **Backup/restore**: the trickiest piece. `node:sqlite`'s `DatabaseSync` has no backup API, so
  verified SQLite's `VACUUM INTO` works as a live-safe snapshot mechanism first (tested standalone
  before touching the real code). Restore requires swapping the live `db` connection after
  overwriting the file, which needed `db/client.ts` refactored from `export const db` to
  `export let db` + `closeDb()`/`openDb()` — ESM live bindings mean every module that already does
  `import { db }` sees the reassignment automatically, no changes needed anywhere else. Verified this
  actually works (see below), not just that it type-checks.
- **Dashboard** (`/dashboard`): today's sales/bills, pending queue size, customer dues, low-stock
  warnings, top debtors, recent audit activity — consumes Phase 3's report endpoints plus the new
  Phase 4 ones.
- **Offline queue**: `pending_transactions.client_ref` (unique, nullable) for idempotent resubmission
  + `lib/offlineQueue.ts` (native browser IndexedDB, no added dependency) on the attendant page. A
  network failure (not a rejected request — that distinction matters, see below) queues the entry
  locally; flushes on `online`, a 20s interval, and a manual button. **Deliberately did not build a
  server-side `sync_queue` table** — `pending_transactions` already is the sync target, and this is a
  single-server architecture, so a second queue table would just duplicate the same facts.

**Verification performed this session:** `tsc`/`eslint`/production build clean in both workspaces (16
web routes). Backend hit over HTTP with the frontend's exact payload shapes throughout (the practice
that caught a real bug last session): shift open → sale during shift → close with matching cash
(variance came back exactly 0, confirming the reconciliation math and the date-format fix above);
audit log entries appear for every hooked action; fin-year and bulk-tax-change round-trip correctly;
**backup → create a customer → restore → customer is gone → server still answers `/health`** — this
was the most important test this session, since it's the one that proves the live-connection-swap
refactor actually works under a real restore, not just that the file operations succeed in isolation;
`client_ref` resubmission returns the original row rather than creating a duplicate. Confirmed a real
CORS preflight for the new cross-origin routes (audit-logs specifically). **Not verified:** the
IndexedDB offline-queue path itself — no browser automation tool was available, so "go offline, enter
a transaction, come back online, watch it auto-sync" was verified by reading the code and by testing
the server-side dedup it depends on, not by actually exercising a real browser's IndexedDB and
`online` event. Flag this explicitly to the user if a browser tool becomes available.

**State:** dev DB and backups directory both reset to a clean seed at end of session. All dev
processes stopped — nothing left running. Also found and killed two lingering `tsx watch` processes
from an earlier smoke-test session that were still holding the db file open (`EBUSY` on `rm`) —
worth being more disciplined about stopping background servers immediately after each verification
pass rather than batching cleanup to end-of-session, since a stale lock silently blocks the next
session's reset.

**Next task:** Phase 5 (Hardening) per `docs/ROADMAP.md` / `Todo.md`: DBF importer for real
historical data, output validation harness vs FoxPro, E2E tests, CI, deployment packaging.

**Notes for the next session:**
- **The test-suite gap is now the single most-repeated flag across sessions (4, 5, and 6).** It has
  gone from "would be nice" to covering zero regression protection over tax, money, billing, stock,
  ledger, mileage, customers, shifts, and — especially — the backup/restore connection-swap logic.
  Phase 5 literally includes "E2E tests, CI" in its own scope, so this is a natural place to finally
  close it rather than deferring a fourth time.
- `docs/MODULES.md` and `docs/MIGRATION_NOTES.md` are still unwritten — Phase 5's DBF importer will
  probably want `MIGRATION_NOTES.md` to exist before or during that work, not after.
- No admin CRUD UI for groups/items master data remains the one UI gap; small relative to what
  existed at the start of Session 5.
- Read `Project_Status.md`'s date-range-query gap bullet before writing any new date-filtered query
  — this is now the second time it's bitten a session (Session 4's reports, this session's shifts).

### 2026-07-12 — Session 7 (Phase 5 — Hardening; all roadmap phases now complete)

**Last completed task:** Phase 5 (Hardening) — complete with adjusted scope, per `docs/ROADMAP.md`.
This closes out the original 5-phase roadmap. Four things built:

1. **DBF importer** (`apps/api/src/dbf/reader.ts` + `import.ts`) — wrote a binary FoxPro/dBase
   `.DBF` record parser from scratch (header + field descriptors + fixed-width records; handles
   C/N/D/L field types; no memo/M support since none of the target tables use it, confirmed via
   `legacy/dbf_schema.py`). Verified it against the real `legacy/Workarea/*.DBF` files (not
   synthetic fixtures) before building the importer on top — this surfaced real data quality
   issues worth knowing about: `USERTAB.LEVEL` is uniformly `0` in the actual data (not 1/2 as
   `docs/DATA_DICTIONARY.md` describes), some `VEH_DET` rows reference customers that don't exist
   in `CUSTOMER.DBF` (confirmed "MKKLS" specifically doesn't exist, proving the importer's
   defensive FK-existence check is doing real work, not just being cautious for nothing), and
   `FLEETCARD.DBF` has no card-number field of its own despite the modern schema needing one —
   documented as a judgment call in `docs/MIGRATION_NOTES.md` (finally written this session, after
   being referenced-but-missing since Session 1). Full import of ~109,282 vehicles + 74 customers +
   69 items + 8 groups + 645 fleet cards + 11 users completes in ~15s and is idempotent (safe to
   re-run). Legacy `USERTAB.PWD` is explicitly **not** imported as a password — it isn't a bcrypt
   hash, so migrated users get a temporary password and must reset it.

2. **Automated test suite** — 29 tests across `tax.test.ts`, `money.test.ts`,
   `repositories/customers.test.ts`, `services/billing.test.ts`, `services/shifts.test.ts`,
   `services/backup.test.ts`. This closes the gap flagged in Sessions 4, 5, and 6. Verified
   `node --test` isolates each test file into its own OS process (checked PIDs directly) before
   designing around it — this matters because it means `process.env.DB_PATH = ":memory:"` set at
   the top of a test file (before a *dynamic* `import()` of anything touching `db/client.ts`, since
   static imports are hoisted and would run before the env var is set) gives that file a private
   in-memory database with no cross-file pollution.

   **Two real bugs found while writing the tests themselves** (not in application code):
   - A fragile hand-written floating-point round-trip assertion in `tax.test.ts` failed due to
     ordinary float imprecision (`967.2 - 147.54 + 147.54 !== 967.2` in IEEE 754). Not a bug in
     `lineTotal` — a bug in my test's assertion design. Replaced with a direct comparison against
     `splitFromInclusive`'s own output instead of hand-deriving an expected value.
   - `backup.test.ts` initially destructured `const { db } = await import("../db/client.js")` and
     then asserted `db.prepare(...)` still worked after `restoreBackup()` closed/reopened the
     connection — and it genuinely failed with "database is not open". Root-caused via an isolated
     repro script: destructuring a dynamic `import()`'s namespace object copies the property's
     *value* at that instant into an independent `const`; it does not track the module's later
     reassignment. Property access on the *retained namespace object* (`mod.db`) does stay live,
     and — critically — every real repository (`import { db } from "../db/client.js"`, a genuine
     static import) was completely unaffected and worked correctly throughout, both in this repro
     and in Session 6's real HTTP-level backup/restore test. So the actual production code was
     never broken; only my test's shortcut for observing `db` was. Fixed by keeping the namespace
     object and using `dbClient.db` throughout. This is now documented as a gap in
     `Project_Status.md` specifically so a future test-writer doesn't rediscover it the hard way.

3. **CI** (`.github/workflows/ci.yml`) — typecheck, lint, test, build. Added root-level
   `npm run typecheck` / `npm run lint` scripts to support it (didn't exist before). Unverified
   against a real Actions run — this repo isn't a git repository yet.

4. **Deployment packaging** — `apps/api/Dockerfile`, `apps/web/Dockerfile` (added
   `output: "standalone"` to `next.config.ts` first, confirmed the build still succeeds and
   produces `.next/standalone/apps/web/server.js` before writing the Dockerfile around it),
   `docker-compose.yml`, `.dockerignore`. **Not build-tested — no Docker available in this dev
   environment.** Said so plainly in the README rather than implying these were verified.

**Deliberately not built, with reasons:** an output-validation harness vs FoxPro reports (no
reference FoxPro output exists anywhere in this repo to validate against — building a harness with
nothing to compare against would be fabricating a check, not performing one) and browser-based E2E
tests (no browser automation tool has been available in any session to date).

**Verification performed this session:** ran the DBF reader against real legacy files before
writing the importer (not after); ran the full importer against the actual ~109K-row dataset and
spot-checked results via the live API (an imported customer, an imported item, an imported vehicle,
a migrated user logging in with the temporary password, and specifically confirming the
"MKKLS"-doesn't-exist FK-fallback case); wrote and iterated the test suite until all 29 passed,
finding and fixing two real issues in the tests themselves along the way; confirmed
`next.config.ts`'s standalone output actually builds before Dockerizing around it; ran typecheck,
lint, test, and build across both workspaces as a final pass. **Not verified:** the Dockerfiles/
compose file (no Docker here) and the CI workflow (repo not on GitHub yet) — both flagged clearly
rather than glossed over.

**State:** dev DB reset to a clean seed, all test/import temp artifacts cleaned up (including some
stray files from an early failing test run before `test.after` cleanup was in place). All dev
processes stopped.

**Next task:** there is no Phase 6 — the original roadmap is complete. Real remaining work (see
`Todo.md`): `docs/MODULES.md` still unwritten, no admin CRUD UI for groups/items, no shared
`packages/*` types, historical transaction data migration not attempted, and the two "written but
unverified" items above (Docker, CI) should be confirmed for real the next time either Docker or a
GitHub push is available.

**Notes for the next session:**
- If you get access to Docker or push this repo to GitHub, that's the natural next verification
  step — confirm the two "written but unverified" deliverables actually work, don't just assume.
- The destructured-dynamic-import gotcha (`Project_Status.md`) is worth remembering for any future
  test file that needs to observe a module-level `let` binding across a reassignment.
- `docs/MIGRATION_NOTES.md`'s fleet-card mapping and `LEVEL`→role mapping are both documented
  judgment calls made without the original FoxPro source's business logic to confirm intent — flag
  to the user if they have deeper knowledge of the legacy system that would change either.

### 2026-07-12 — Session 8 (post-roadmap gap closing)

**Context:** asked the user "go ahead" after Session 7 closed out the roadmap, but the instruction
was ambiguous (could have meant "init git", "tackle remaining gaps", or something else) — asked a
clarifying question rather than guessing, since git-init and continuing feature work are different
enough in scope that guessing wrong would waste a whole session. User chose: tackle the remaining
gaps from `Todo.md`.

**Last completed task:** two of the three gaps flagged at the end of Session 7.

1. **`docs/MODULES.md`** — before writing anything, spawned a research pass over
   `legacy/Workarea/` to find the actual menu structure rather than inferring one from filenames.
   Finding worth remembering: there are no compiled `.MNX`/`.MNT` menu files anywhere — the whole
   menu is built at runtime in `MAINMENU.PRG`, and **most of what it dispatches to no longer
   exists as source** (only `BILLEN.BAK`, `IWGSTREP.PRG`, `BACKUP.PRG`, `HEADER.PRG` survive as real
   business logic; everything else is report-layout-only or has no surviving artifact at all). The
   doc tags every menu item with which of those three states applies, specifically so nobody
   assumes a `.PRG` exists to consult when it doesn't. Cross-referencing the legacy menu against
   what PetroPro actually has built also surfaced concrete gaps that weren't documented this
   precisely before: no user-management UI/API at all, no receipt printing, no way to retract a
   scheduled rate change, no settings screen for the legacy operational flags (kerosene/fleet-card/
   print-test). Also documented some legacy-codebase trivia worth knowing but not acting on: a
   multi-dealer white-label deployment (3+ different petrol stations sharing one codebase via
   hardcoded per-dealer header programs), an obfuscation/licensing-gate cluster, and a hidden F12
   developer console with a hardcoded password.

2. **Admin CRUD UI for groups/items** (`/catalog`) — the backend endpoints
   (`POST/PUT /groups`, `POST/PUT /items`) already existed since Phase 1; only the frontend screen
   was missing. Groups: list + create + inline rename. Items: list + create/edit form covering all
   fields (group assignment, wholesale/retail/purchase pricing, tax %, mileage-tracking flag).

**Not done:** the third flagged gap, a `packages/*` shared types package, was explicitly deprioritized
— it's a "reduce future drift risk" refactor, not a missing capability, and lower value than the two
above given limited session time.

**Verification performed this session:** `tsc`/`eslint`/production build clean (17 web routes, up
from 16). Hit the groups/items endpoints with the frontend's exact payload shapes — create group,
rename group, create item with a group assignment, create item with `group_code: null` explicitly,
edit an item and confirm the derived tax-split fields (`price_retail_pretax`/`_tax`, etc.) recompute
correctly from the new rate — and confirmed the cashier role is blocked from mutating the catalog
(403) but can still view it (200), matching the existing backend role gates exactly.

**State:** dev DB reset to a clean seed. All dev processes stopped.

**Next task:** none prescribed — the roadmap is complete and this session closed two of the three
gaps flagged at its end. Whatever's next should come from the user, or from `Todo.md`'s remaining
list if they want another autonomous gap-closing pass.

**Notes for the next session:**
- `docs/MODULES.md`'s menu-vs-built-features cross-reference is now the most complete single
  inventory of "what the legacy app could do that PetroPro doesn't yet" — read it before assuming a
  feature request is net-new; it might be a documented legacy-menu-item gap already.
- The `packages/*` shared-types refactor is still on the table if a future session has spare
  capacity and no more pressing feature/doc gap to close.
- Docker and CI verification are still the two "written but never actually run" items — flag this
  again if either becomes testable (Docker installed, or repo pushed to GitHub).

### 2026-07-13 — Session 9 (user management)

**Context:** after Session 8 closed two of three flagged gaps, the user said "Continue" with no
further specifics. Unlike the ambiguous "Go ahead"/"proceed" prompts earlier in this project (which
each warranted a clarifying question since they could have meant meaningfully different things),
this one followed directly from a menu of options I'd just laid out with no strong steer either
way — read as "keep going, use your judgment," not as a fresh ambiguous instruction. Picked the
highest-value remaining item myself: no user-management UI/API at all, surfaced by Session 8's
`docs/MODULES.md` cross-reference. Every account before this session came only from `db/seed.ts` or
the DBF importer — there was no way to onboard a new cashier/attendant, or deactivate one who left,
without editing the database directly.

**Last completed task:** full user management, backend and frontend.
- `users.active` column (schema).
- `usersRepo`: `create()` changed from `void` to returning the created user (never including
  `password_hash`) — checked every existing call site (`seed.ts`, the DBF importer, both test
  files) before making the change; none used the old `void` return, so nothing broke.
  Added `update()`, `setActive()`, `setPasswordHash()`.
- Login now checks `active` — verified this as a *distinct* code path, not just inferred from the
  wrong-password 401: created a user, deactivated them, then logged in with their **correct**
  temporary password and confirmed the deactivation-specific error message, not a generic
  "invalid credentials."
- `routes/users.ts` (admin-only, not manager): list, create (auto-generates a temporary password
  unless one is supplied — returned once, never persisted in plaintext), update, deactivate,
  reactivate, reset-password. Two judgment calls worth recording: (1) create checks for an existing
  `user_id` first and returns 409, rather than letting a raw SQLite PK-constraint violation bubble
  up as an uncaught 500 the way some earlier routes in this codebase still do (not fixed
  retroactively — scope creep on unrelated code — but done properly for what was newly built);
  (2) an admin cannot deactivate their own account (400) since there's no other in-app path back in
  if the last admin locks themselves out.
- 4 new tests (`repositories/users.test.ts`): active defaults to 1, `password_hash` never leaks
  through `create`/`update`/`list`, `setActive`/`setPasswordHash` work. 33 tests total (was 29).
- `/users` admin page — gated to the `admin` role specifically in the `NavBar`/`useRequireSession`
  call, matching the backend's `requireRole("admin")` exactly (not `admin`+`manager` like most
  other admin screens) so a manager never sees a link to a page that would 403 them.

**Verification performed this session:** full test suite (33/33), `tsc`/`eslint`/production build
clean in both workspaces (18 web routes, up from 17). Drove the complete lifecycle over HTTP with
the frontend's exact payload shapes: create (no `password` field, matching how the form omits it)
→ login with the returned temp password → duplicate `user_id` correctly 409s → deactivate → login
with the *correct* password still correctly rejected → self-deactivation attempt correctly 400s →
reactivate → reset-password → update name/role → non-admin correctly 403'd from every `/users`
route while still able to log in and use the rest of the app normally. Confirmed CORS for the new
routes.

**State:** dev DB reset to a clean seed. All dev processes stopped.

**Next task:** none prescribed. Two gaps remain from Session 8's original three-item list only in
the sense that `packages/*` shared types was never one of the three closed — everything else
flagged at the end of Session 8 is now done. Remaining real gaps are listed in `Todo.md`.

**If the user's next message is just "continue" (or similarly bare, e.g. "go ahead," "proceed")
with no further specifics:** the user told me directly, at the end of this session, that this is
what they'd say next time and that it should be read as authorization to keep going
autonomously — not as a fresh ambiguous instruction requiring another clarifying question. Treat it
as: read `Todo.md`'s "Real remaining gaps," pick the highest-value item using your own judgment
(this is exactly what happened in Sessions 8 and 9 — Session 8 was asked explicitly to tackle gaps,
Session 9's bare "Continue" was read the same way since it followed a menu of options with no steer
either way), implement it with the same rigor as every prior session (verify against a running
server with the frontend's exact payload shapes, run the full test suite, update these three
handoff docs before ending), and report what you picked and why. Don't re-ask "which gap should I
pick" — that question was already answered in advance.

**Notes for the next session:**
- The temporary-password pattern (returned once in the API response, never emailed/SMS'd, no
  notification channel exists) means whoever creates a user or resets a password has to relay it
  out-of-band. Worth knowing if a future session is asked to add any kind of "forgot password"
  self-service flow — there's no email/SMS infrastructure to build on yet.
- The self-deactivation guard is a hard block with no override — if this ever needs to change
  (e.g. a "transfer admin rights before deactivating" flow), it's a one-line check in
  `routes/users.ts`.

### 2026-07-17 — Session 10 (gap closing: rate-change retract, receipt PDF, operational settings, shared types)

**Context:** user said "Proceed with filling the gaps," referring to `Todo.md`'s "Real remaining
gaps" list. Unlike a bare "continue," this named the gap list explicitly and used the plural, so it
was read as authorization to work through several items in one session rather than picking exactly
one (Session 9's protocol for a bare "continue"). Picked the four gaps that were actually actionable
in this environment and skipped the rest without faking progress: no Docker install here (blocks
verifying the Docker packaging), repo still isn't a git repository (blocks CI), no browser
automation tool is available (blocks Playwright/Cypress E2E), and no reference FoxPro report output
exists in this repo to validate against (blocks the output-validation harness). All four of those
remain open — see `Todo.md`.

**Last completed tasks, in order:**

1. **Rate-change delete/retract** (`repositories/rateChanges.ts`, `routes/rateChanges.ts`,
   `app/rate-changes/page.tsx`). Added `rateChangesRepo.get()`/`remove()` — `remove()` only deletes
   a row where `applied = 0` by using that condition directly in the `DELETE` statement's `WHERE`
   clause (not a separate check-then-delete, so it's race-free), and returns whether a row was
   actually removed. `DELETE /rate-changes/:id` 404s if the id doesn't exist, 400s if it's already
   applied (deleting an applied change would erase the audit trail for a price change that already
   took effect on the item), otherwise removes it and audit-logs `retract_rate_change`. Web page
   gained a "Retract" button per pending row (hidden once a row is applied). 2 new repo tests
   (`repositories/rateChanges.test.ts`).

2. **Receipt PDF output** (`services/receiptPdf.ts`, new `GET /receipts/:recNo/pdf`). Mirrors
   `services/invoicePdf.ts`'s pattern exactly (pdfkit, A5, manual x/y layout, company letterhead
   from `companyProfileRepo`, `amountInWords()` for the amount line) — deliberately not
   generalized into a shared "printable document" abstraction since the two documents' layouts
   don't actually share structure beyond "pdfkit + letterhead". Added `receiptsRepo.get()` (only
   `listByCustomer()` existed before). Wired into the UI two ways: a "Print" link on any `receipt`
   row in the customer ledger table (`app/customers/page.tsx`), and a "Print" link that appears
   immediately after recording a new receipt — both use the existing `downloadAuthed()` helper the
   same way the bill invoice PDF does.

3. **Operational settings screen** (legacy `SETTINGS.DBF`-style flags). Dumped the actual
   `legacy/Workarea/SETTINGS.DBF` rows (the DBF dumper script only reads headers, so this needed a
   one-off row-reader) rather than guessing key names: `VERSION`, `KEROSENE`, `FLEETCARDENTRY`,
   `PRINTTESTMODE`, `PRINTSPECIALCHARACTERS`, `BILLENTRY`, `WORKINGPATH`, `GSTNO`, `GSTNAMEADD`.
   `SETTINGS.PRG` (the legacy program that edited these) doesn't survive anywhere in this repo — same
   "menu dispatches to source that no longer exists" situation `docs/MODULES.md` already documented
   for other menu items — so there's no ground truth for these flags' exact runtime behavior, only
   their names/legacy defaults. Scoped this to what the gap actually asked for (a settings *screen*,
   not new behavior gated by these flags): new `settings` table (key/value, same shape as the DBF),
   seeded with the legacy defaults, for the 6 keys that make sense in a web app (`VERSION` is an app
   version not a flag; `WORKINGPATH` is a DOS path; `GSTNO` already lives in `company_profile.gst_no`
   — none of those three are exposed here). `GET /settings` is admin+manager (read), `PUT /settings`
   is admin-only (matches how `/users` mutations are scoped tighter than reads elsewhere in this
   app) and audit-logs `update_settings`. New "Operational Settings" section on the existing
   `/settings` page (toggle pills, disabled for non-admins) — this page already existed for company
   profile/fin-year/bulk-tax/backup, so this was an addition to it, not a new route. 2 new repo
   tests (`repositories/settings.test.ts`).

4. **`packages/shared-types` workspace package** — the last remaining Session 8 gap. Compared
   `apps/web/lib/api.ts`'s hand-declared interfaces against `apps/api`'s repository types first:
   they're genuinely *not* identical (e.g. web's `Item` is missing the `*_pretax`/`*_tax` columns,
   web's `Customer` is missing `joined_on`/`print_name`/`tin_no`) — the frontend only ever needed a
   subset of what the backend's DB-level types carry. So this package holds the *wire-format*
   contract (what routes actually send/what the frontend actually consumes), not a forced unification
   with backend-internal types — trying to make repository types satisfy a shared shape would have
   meant picking fields at every route boundary, which is real, riskier work nobody asked for.
   Moved every interface `apps/web/lib/api.ts` used to declare (plus the two independently-declared
   `Role` unions — one in `apps/web/lib/auth.ts`, one in `apps/api/src/repositories/users.ts`, found
   by grepping for the exact literal union — into `packages/shared-types/src/index.ts`.
   `apps/web/lib/api.ts` now imports them and re-exports them under the same names so none of the 12
   other files across `apps/web` that do `import { type X } from "@/lib/api"` needed to change.
   Every export in the package is `export type`/pure type alias (no runtime values), which matters
   for the build: type-only imports get fully erased by `tsc`/Next's compiler, so neither
   `apps/api/dist` nor `apps/web/.next/standalone` ends up needing the package present at runtime —
   only at build/typecheck time. That meant the Dockerfiles needed a build-time-only fix (copy
   `packages/shared-types`, build it, before building the app image) with **no runtime-stage
   change** — done for both `apps/api/Dockerfile` and `apps/web/Dockerfile`, but like the rest of
   the Docker setup this remains unverified (no Docker available here). Root `package.json` gained a
   `postinstall` that builds the package after `npm install` (so `dev`/`test`/`seed` don't need their
   own build-it-first step) and `build`/`typecheck` were updated to build it explicitly too, for CI
   robustness independent of `postinstall` having already run.

**Verification performed this session:** `npm run typecheck` (both workspaces + the new package)
clean, `npm run test` 37/37 (was 33 — the 4 new tests are 2 for rate-change retract, 2 for
settings), `npm run lint` clean, `npm run build` clean (still 18 web routes — no new routes were
added, both new UI pieces extended existing pages). Then a full HTTP pass against a running server
with a freshly reset seed DB, same rigor as every prior session: settings — GET returns the legacy
defaults, PUT rejects an unknown key (400) and a non-YES/NO value (400), a manager can GET but gets
403 on PUT (created a throwaway manager account via `/users` to test this since none was seeded),
the audit log records `update_settings` with the changed keys. Rate changes — created one, deleted
it (204, gone from the list), deleting a nonexistent id 404s, applied a due one via
`/rate-changes/apply-due` then confirmed retracting the now-applied one correctly 400s. Receipts —
created a customer and a receipt, fetched `/receipts/:recNo/pdf` and confirmed a real single-page
PDF came back (`file` command confirmed `PDF document, version 1.3, 1 page(s)`), fetching a
nonexistent receipt's PDF 404s. One process-hygiene snag: `TaskStop` on the background dev-server
task didn't kill the actual `tsx watch` child holding port 4000/the SQLite file — had to find it via
`netstat -ano` and kill that PID directly before the dev DB could be reset to a clean seed.

**State:** dev DB reset to a clean seed (the manager/customer/rate-change/settings test data created
during verification is gone). All dev processes stopped.

**Next task:** none prescribed. Four gaps are now closed. What's left in `Todo.md` is exactly the
four blocked-by-environment items named above, plus the smaller accumulated items in
`Project_Status.md`'s "Known gaps" (unchanged by this session). If the user's next message is a bare
"continue"/"proceed" with no further specifics, Session 9's standing instruction still applies: work
autonomously rather than re-asking which gap to pick — but at this point that would mean picking
between the historical-transactional-data-migration effort (large, not previously attempted) or
polishing one of the smaller known gaps, since everything else left is genuinely blocked here.

**Notes for the next session:**
- `packages/shared-types` has no build-watch story — editing its `src/` requires re-running its
  build (`npm run build --workspace packages/shared-types`, or reinstall which triggers
  `postinstall`) before `apps/api`/`apps/web` will see the change, since both consume its compiled
  `dist/`, not the source directly. Fine for a package that changes rarely; worth knowing if it
  starts changing often.
- The `SETTINGS.DBF` key semantics beyond their names (`BILLENTRY`, `GSTNAMEADD`,
  `PRINTSPECIALCHARACTERS` especially) are unverified — `SETTINGS.PRG` doesn't survive to check
  against. The screen built this session stores/displays them faithfully but doesn't wire any of
  them into actual behavior changes elsewhere in the app (e.g. `FLEETCARDENTRY=NO` doesn't currently
  hide fleet-card fields anywhere) — that would be a separate, larger effort if ever needed.
- `services/rateChanges.ts`'s `applyDueRateChanges()` returns the pre-mutation snapshot of the rows
  it just applied (fetched via `dueOn()` before the loop that calls `markApplied()`), so the
  response body shows `applied: 0` for changes that are, by the time the response is sent, actually
  `applied: 1` in the database — confirmed this is cosmetic only (a follow-up `GET /rate-changes`
  shows the correct state) while verifying the retract-blocks-on-applied behavior this session, not
  something introduced by this session's changes. Pre-existing, out of scope here, noted for whoever
  next touches that file.

### 2026-07-18 — Session 11 (demo transaction data)

**Context:** after Session 10's gap-closing pass, asked "whats next" — presented options
(historical migration, git init + CI/Docker verification, small known-gap polish, or "something
else"). User picked "something else": load real data for a client demo, explicitly **not** the
full historical migration — "do not migrate all the data, just keep last 3 months of data ... to
show case the application to clients." A follow-up question (shift dates to look current, or keep
them historical) was answered: keep the original historical dates.

**Last completed task:** `apps/api/src/dbf/importTransactions.ts` (new) — a scoped, one-off
transactional importer, deliberately separate from `import.ts` (master data) rather than folded
into it, since `docs/MIGRATION_NOTES.md` already documents that full transactional migration is
out of scope and this isn't that.

- **Found the real window first, didn't guess it.** `legacy/dbf_schema.py` only reads DBF headers,
  not rows, so wrote a one-off row-scanner to read actual `BILL_DATE`/`SDATE`/`PUR_DATE` values out
  of every monthly transactional DBF. Filenames alone aren't reliable — `MARBIL02.DBF` (year 2002)
  sits right next to `MARBIL18.DBF`, and the `19`-suffixed files aren't necessarily "newer" than
  `18`-suffixed ones without checking. The real most-recent 3 consecutive months turned out to be
  `APRBIL19`/`MAYBIL19`/`JUNBIL19` (2019-04-01 through 2019-06-15), with matching `*STK19` stock
  files running through 2019-06-16, `PURCH19` purchases, and `MAGE19` mileage — confirmed all four
  data sources align to the same window before writing any import logic.
- **Found and fixed a real bug mid-verification, not after shipping.** First implementation grouped
  bill lines into bills by `BILL_NO` alone (matching the naive reading of
  `docs/DATA_DICTIONARY.md`'s "BILL_NO groups lines into a bill"). Spot-checking the first imported
  bill showed a ₹10+ lakh single "bill" with a mismatched vehicle/customer/time pattern inside it —
  traced back to the actual DBF rows and confirmed `APRBIL19.DBF`'s `BILL_NO=1` really does cover
  two unrelated transactions: a 00:28 retail fuel sale to `TN04AB-1839`/customer `DIVYA`, and a
  22:19 multi-item entry with `VEH_NO='-'` and no customer. `BILL_NO` turns out to repeat across
  unrelated transactions within a single monthly file (verified: 221 overlapping `BILL_NO` values
  between `APRBIL19` and `MAYBIL19` alone). `BTIME` is stamped identically across every line of one
  real transaction and never collides between distinct ones in the same file (checked the full
  group-size distribution: 1,256 single-line groups up to 3 eight-line groups, all internally
  BTIME-consistent) — switched to grouping by `(BILL_NO, BTIME)`, re-ran, re-verified the same bill
  now splits correctly into two normal-sized bills. Documented as a standing gotcha in
  `docs/MIGRATION_NOTES.md` and `Project_Status.md`'s "Known gaps" for anyone who touches raw bill
  DBFs again.
- **Scoped what NOT to import, deliberately, not by omission.** `BILLCNCS.DBF` (cancelled bills):
  skipped — that table's schema lacks `RATE`/`RATEBTX`/`TAX_PER`/`TAX_AMT`, so reconstructing
  `bill_lines` for a cancelled sale would mean inventing tax figures that were never recorded.
  Receipts (`RECPT19.DBF`): skipped — the real dataset has zero rows in this window, confirmed by
  reading the file (0 records), not assumed. Neither is a gap in the importer; both are "there's
  nothing there to import."
- **Did not touch `customers.due_amount`.** It's a live snapshot from `CUSTOMER.DBF` reflecting
  balances years after this window; running these historical credit bills through the same
  `adjustDueAmount()` the live billing flow uses would double-count against years of activity this
  repo has no record of. Bills/lines/stock/purchases/mileage were inserted with direct SQL (mirrors
  the existing `importVehiclesAndFleetCards()` pattern in `import.ts`) rather than going through
  `billsRepo.create()`/`services/billing.ts`, specifically to avoid triggering that side effect (and
  because `billsRepo.create()` hardcodes `bill_date` to `datetime('now')`, which would have erased
  the real historical dates the user asked to keep).
- Vehicles referenced by these bills but missing from the already-imported `vehicles` master table
  (2 of ~448 in April alone) are auto-created via the same `vehiclesRepo.findOrCreate()` the live
  walk-in billing flow already uses for unknown vehicles — reused existing, tested behavior rather
  than writing new vehicle-creation logic.
- **Idempotency**: unlike master-data tables (natural key per row), bills/bill_lines/mileage_log
  have no natural key to dedupe against. Used a single coarse run-once guard instead (skip the
  entire import if any bill is already dated in the 2019-04-01..2019-06-16 window) — correct and
  much simpler than per-row keys, given this script imports one fixed window rather than being an
  ongoing feed. Verified by running the importer twice; the second run correctly no-ops.
- New npm script: `apps/api`'s `import:demo-transactions` (parallel to the existing `import:legacy`).

**Verification performed this session:** ran against the real `legacy/Workarea/` data end to end
(fresh seed → `import:legacy` → `import:demo-transactions`) — 3,606 bills, 4,047 bill_lines, 5,313
stock_daybook rows, 114 purchases, 2 mileage_log rows, 1 bill/1 line correctly rejected (unknown
item code). Direct SQLite spot-checks: no negative stock balances anywhere in the window, the
specific bill-splitting fix verified against the raw source rows before and after. Full HTTP pass
against a running server: bill register (3,606 rows), item-wise monthly sales report, stock report
for a specific item, purchase report, GST summary, and a real credit customer's
(`DIVYA`) ledger for the window — all returned correct, internally-consistent data. `npm run test`
still 37/37 (no test changes this session — this project's DBF importers are verified by a real run
+ spot-checks per `docs/MIGRATION_NOTES.md`'s established convention, not unit tests; `import.ts`
itself has never had one either). `typecheck`/`lint`/`build` all clean.

**State:** unlike every prior session, **the dev DB was deliberately left loaded**, not reset to a
bare seed — that's the actual deliverable here (a client demo needs data in it). All dev processes
stopped (had to `netstat -ano`/`taskkill` a lingering `tsx watch` child again — see Session 10's
note on `TaskStop` not reliably killing it).

**Next task:** none prescribed. If asked to keep going, `Todo.md`'s "Real remaining gaps" is
unchanged in substance from Session 10 (full historical migration, the three environment-blocked
items) — this session added a scoped demo slice alongside those, not a replacement for any of them.

**Notes for the next session:**
- If someone runs `npm run seed` again on this same `apps/api/data/petropro.db`, master data and
  the demo transaction window both stay (seed only inserts if missing; the transaction importer's
  run-once guard means re-running `import:demo-transactions` is a safe no-op too) — but if the DB
  file is deleted and recreated, both importers need to be re-run in order (`import:legacy` before
  `import:demo-transactions` — the latter validates FKs against master data).
  `docs/MIGRATION_NOTES.md` has the exact commands.
  - There's a real, unexplained-by-us pattern in the source data worth knowing before demoing off
  it: several large (some 7-figure ₹) bills per month with `vehicle_no='-'` and no customer, at
  suspiciously round late-evening/day-end times. Read as day-end bulk stock-adjustment or
  depot-transfer entries logged through the same bill mechanism as customer sales — genuinely in
  the source, not an import artifact, but "largest bills" or "top customers by spend" demo views
  will surface these rather than a real customer's biggest fuel purchase. Worth a heads-up to
  whoever presents the demo, not something to silently filter out (that would be guessing at
  business meaning the data doesn't confirm).

### 2026-07-29 — Session 14 (doc-gap note + Google SSO, desktop launcher, offline bill idempotency, auto-backup, HSN/group reports)

**Doc-gap note, read first:** this handoff log stopped being updated after Session 13, but the repo
kept moving — `git log` shows the repo was later (re-)initialized as a single "Initial commit:
PetroPro PWA (Phases 1-4) plus running business-date billing," then three more commits landed with
no matching handoff entry: `6eb6f57` "Add mileage tracking, customer order portal, and richer
reporting", `4b1e977`/`f17bd34` (excluding `WorkareaTill29Mar2026` legacy data from the Docker/
Vercel build context), and `91630be` "Add HSN code to Item Master with GST-compliant format
validation". None of those sessions' actual reasoning/verification detail was captured here — if
you need that context, it isn't recoverable from this file, only from reading the commits
themselves. Restarting doc discipline from this session forward.

**Context:** picked up mid-session from a large uncommitted working tree — a full feature batch was
already written (untracked new files + modifications across ~27 tracked files) but never verified
end-to-end or committed. Asked the user how to proceed after finishing verification; they chose
"update handoff docs first, then commit."

**What was already in the working tree (built by whatever session came before this one, not by me
this session):**
- **Google SSO for staff** (`apps/api/src/routes/googleAuth.ts`, `apps/web/app/login/callback/`) —
  additive to password login, matches by `users.email` (new nullable+unique column) against an
  *existing active* user only; no auto-provisioning. CSRF `state` is HMAC-signed with the app's own
  JWT secret and carried in the redirect URL (no server-side session needed for the round trip).
  Session handoff back to the SPA rides in a URL fragment, never a query string, so it can't land in
  server access logs. Gated by `NEXT_PUBLIC_GOOGLE_SSO_ENABLED` on the web side and
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` on the API side — absent either, the feature no-ops
  cleanly (501 from the API, no button on the web login page).
- **Desktop kiosk launcher** (`scripts/desktop/start.mjs`, `apps/web/components/DesktopTitleBar.tsx`)
  — starts the built API + Next.js standalone server locally, then opens a chromeless
  `chrome/edge/brave --app --kiosk` window (falls back to the OS default browser if none found), so
  the app behaves like a native install with no Electron/Tauri runtime. A same-origin, localhost-only
  control server (`DESKTOP_CONTROL_PORT`, default 4098) lets `DesktopTitleBar`'s Close button shut
  the whole thing down, since a kiosk window has no window chrome of its own to close. Explicitly
  modeled on WareCore's existing `scripts/desktop/start.mjs` pattern (per the file's own comment).
- **Offline bill-queue idempotency** — `bills.client_ref` (new nullable+unique column, same pattern
  `pending_transactions.client_ref` already used), `billsRepo.getByClientRef()`,
  `createWalkInBill()` short-circuits to the existing bill on a repeat `client_ref` instead of
  double-posting. Web side: `lib/offlineQueue.ts` gained a second IndexedDB object store
  (`queued-bills`, DB version bumped 1→2 with an `onupgradeneeded` that only creates whichever store
  is missing, so existing installs keep their queued pending-transaction entries) plus
  `queueBill()`/`flushBillQueue()`, mirroring the existing pending-transaction queue/flush pair.
- **Automatic daily backups** — new `AUTOBACKUP`/`OFFLINEMODE` settings keys (schema defaults +
  `SETTINGS_KEYS`, toggle UI on `/settings`); `services/backup.ts` gained
  `runAutoBackupIfDue()`/`startBackupScheduler()` (checked on startup, then every 24h; skips if the
  newest backup on disk is under a day old) plus `pruneOldBackups()` (keeps the newest 14) and
  `getBackupPath()`. `startBackupScheduler()` is called from `index.ts` after the server starts
  listening — deliberately not from `buildApp()`, so building the app for tests never schedules
  background work. New `GET /backup/:filename/download` route (streams the file; the prior API could
  create/list/restore backups but never get a copy off the server).
- **HSN-wise GST report + group-nested stock/purchase reports** — `reportsRepo.salesByHsn()` (GSTR-1
  HSN-wise table, groups by `items.hsn_code` instead of tax rate), `stockSummary()` and the new
  `purchasesByGroupItems()` both now carry `group_code`/`group_name` so the reports page can nest
  items beneath their group, matching the existing sales-by-group-item report's shape.
- **Users page gained an `email` field** (create + inline edit) — this is what an admin sets to
  enable Google SSO for a staff account; column is otherwise unused by anything else.

**What I actually did this session:**
1. Read the full diff/untracked-file set file-by-file to confirm the batch was internally consistent
   (routes registered in `app.ts`, scheduler started from `index.ts`, schema migrations present,
   shared-types updated, UI wired to the new endpoints) rather than assuming from the diffstat alone.
2. Ran `npm run test` (73/73), `npm run typecheck` (clean across `shared-types`+`api`+`web`),
   `npm run lint` (found one issue), `npm run build` (clean, 21 web routes).
3. **Fixed the one lint finding**: a stale `eslint-disable-next-line react-hooks/set-state-in-effect`
   comment in `apps/web/app/(app)/billing/page.tsx` (line 185) — the rule was no longer firing there,
   so ESLint flagged the directive itself as unused. Removed it; re-ran lint clean.
4. **Wired the missing integration point**: `scripts/desktop/start.mjs` existed and was fully
   functional but nothing in root `package.json` invoked it. Added a `"desktop": "node
   scripts/desktop/start.mjs"` script.
5. Re-ran the full test/typecheck/lint/build pass after both fixes — all clean.

**Verification performed this session:** the four commands above, all clean, on the exact code as it
now sits in the working tree. **Not verified:** the Google OAuth round trip against real Google
infra (no `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` configured in this environment, and no browser
automation tool available — same standing gap as every prior session), and the desktop kiosk
launcher's actual browser-opening behavior (would need a built `apps/api/dist` +
`.next/standalone` plus a real Chromium install to exercise `scripts/desktop/start.mjs` end-to-end,
not attempted this session — build-clean and read-through were the extent of verification here).

**State:** working tree changes verified clean and then committed this session (see the commit for
the exact file list).

**Next task:** none prescribed beyond what's in `Todo.md`. If picking up the two "not verified" gaps
above: Google SSO needs real Google Cloud OAuth credentials to test against, and the desktop launcher
needs an actual `npm run build` + a Chromium browser on the machine running it — neither is possible
in a headless dev-container environment like this one, so flag that plainly rather than attempting a
fake pass.

**Notes for the next session:**
- Resume the per-session handoff-doc discipline this file establishes — it lapsed for at least the
  four commits listed in the doc-gap note above, and losing that trail is exactly the failure mode
  this file exists to prevent.
- The `GOOGLE_SSO_ENABLED`/`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI`/
  `WEB_APP_URL`/`DESKTOP_CONTROL_PORT` environment variables are read by `config.ts` files on both
  sides but there is still no `.env.example` anywhere in this repo (there wasn't one before this
  session either) — worth adding if a future session has spare capacity, so these don't have to be
  rediscovered by grepping source.

### 2026-07-29/30 — Session 15 (real browser verification: offline sync + AutoComplete Combobox)

**Context:** continued directly from Session 14 in the same working session (spans the midnight
rollover — commits/log timestamps below may read 07-29 or 07-30 depending on exactly when a given
action ran). Asked the user what to pick up next; three options were offered (verify offline sync
for real, start the untracked WhatsApp invoice module PDF, or another `Todo.md` gap) — they picked
verifying offline sync. Mid-verification, the user separately rejected an unrelated tool call
specifically to hand over a new instruction: replace the shared `Combobox` component (native
`<input list>`/`<datalist>`) with a real autocomplete dropdown, applied everywhere it's used. Asked
how to sequence the two; the user chose to finish the in-progress verification first.

**Part 1 — first real browser automation available in this project's history.** Every prior session
(1 through 14) noted "not verified — no browser automation tool available" for anything requiring
actual UI interaction; that was a genuine environment limit, not a shortcut taken. This session found
one: no `chromium-cli`, but the Windows machine has Edge installed at
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. Installed `playwright-core` (not
full `playwright` — avoids downloading a bundled Chromium, since a real browser was already on disk)
in a throwaway npm project under the session scratch directory, and launched it with
`chromium.launch({ executablePath: EDGE_PATH, headless: true })`. This is a reusable recipe for this
environment going forward, not a one-off.

**Part 2 — offline billing sync verified end-to-end, for real:**
- Started both dev servers. Discovered along the way that the root `"dev"` script
  (`npm run dev --workspace apps/api & npm run dev --workspace apps/web`) silently only starts the
  API on this Windows setup — npm scripts run through `cmd.exe` here, where `&` sequences commands
  rather than backgrounding them the way bash does, so the (never-exiting) API dev process blocks
  the web one from ever starting. Worked around it by starting `dev:api`/`dev:web` separately this
  session; **not fixed in `package.json`** — flagged here rather than silently patched, since the
  right fix (cross-platform background launcher, e.g. `concurrently`) is a small dependency
  decision that felt worth surfacing rather than assuming.
- Logged in as `admin` via the real login form, turned `OFFLINEMODE` on via a direct API call,
  navigated to `/billing`, added a line to the pre-filled first item.
- `context.setOffline(true)` — Playwright's real network-condition emulation, which actually flips
  `navigator.onLine` and fires the browser's native `offline` event (unlike, say, intercepting
  `fetch` calls, which wouldn't exercise the app's `window.addEventListener("online", ...)` path at
  all). Submitted the bill: got the "Offline — bill queued" notice in the UI, then independently
  confirmed via `page.evaluate()` reading `indexedDB.open("petropro-offline")` directly that the
  bill was really sitting in the `queued-bills` object store — not just a UI-only claim.
- `context.setOffline(false)` — the page's own `online` listener fired `flushBillQueue()`
  automatically with zero manual action from the test script. Re-read IndexedDB: the store was
  empty. Checked the Recent Bills panel: the new bill (`#45449`, ₹135.04) was there.
- Separately verified the idempotency guarantee this whole mechanism depends on, directly against
  the API (bypassing the browser): posted the same `clientRef` to `POST /bills` twice in a row —
  both responses came back with the identical `bill_no` (`45450`), confirming a retried sync can
  never double-post.
- **Cleaned up afterward**, since the dev database on disk is the real Session 11 demo dataset, not
  a throwaway: cancelled both test bills (`45449`, `45450`) via `POST /bills/:billNo/cancel` and
  reverted `OFFLINEMODE` back to `NO`. Stopped both dev servers (`Stop-Process` on the listening
  PIDs — `TaskStop`/normal kill doesn't reliably reach the actual `tsx watch`/`next dev` child on
  this setup, same gotcha Sessions 6 and 10 already flagged).

**Part 3 — Combobox rewritten as a real autocomplete** (`apps/web/components/ui/Combobox.tsx`):
- Read every existing call site first (9 files: billing ×3, customer orders, catalog, settings,
  attendant ×2, purchases, cashier, rate-changes) to confirm the external contract to preserve:
  `options: {value,label}[]`, `value: string`, `onChange: (value: string) => void`, plus arbitrary
  native `<input>` props and `className` passed through. Critically, several callers rely on
  `onChange` firing on *every keystroke*, not just on selecting a suggestion — e.g. billing's
  customer-code field is looked up against the loaded customer list by whatever's currently typed,
  and typing a code that doesn't (yet) match anything is a valid, expected state. The rewrite
  preserves this exactly: `onChange(e.target.value)` still fires on every input event; the dropdown
  is a pure addition, not a gate on what value can be set.
- New behavior: opens on focus, filters `options` by substring match against label or value
  (case-insensitive, capped at 50 rendered rows — not stress-tested against a catalog bigger than
  this demo's ~69 items, fine for now), full keyboard nav (`ArrowUp`/`ArrowDown` to move a
  highlighted index, `Enter` to select the highlighted row, `Escape` to close), and click-to-select.
  Click-to-select uses `onMouseDown` + `preventDefault()` on the option, not `onClick` — `onClick`
  would fire *after* the input's `onBlur` (which closes the dropdown), so a plain click would race
  its own dropdown-closing logic and sometimes miss; `preventDefault()` on `mousedown` stops the
  blur from happening at all, so the click always lands on a still-open list.
- **One real lint catch mid-build**: the first draft cleared a stale highlighted-index via
  `useEffect(() => { if (highlighted >= filtered.length) setHighlighted(0) }, [...])`.
  `eslint-plugin-react-hooks`'s `set-state-in-effect` rule correctly flagged this as a
  cascading-render risk — it would re-render an extra time on every keystroke that shrank the
  match list. Fixed by deriving `activeIndex` inline (`Math.min(highlighted, filtered.length - 1)`)
  instead of storing the clamped value as state at all — no effect needed.
- Preserved `list`/`datalist` being unnecessary now (native browser autocomplete UI is fully
  replaced by the custom dropdown) — the prop type still `Omit`s `list` from the underlying
  `InputHTMLAttributes`, just no longer needs to construct one.

**Visual verification** (same `playwright-core` + Edge setup as Part 1), on the real running app:
typing "pet" into the billing page's item field correctly filtered to `PETROL`, `PET ADDITIVE`, and
`PET` (item code for "Petrol") — confirming the label-or-value substring match; two `ArrowDown`
presses correctly highlighted the third (`Petrol`) row; `Enter` selected it, set the input value to
`PET` (the item *code*, matching the existing `onChange(option.value)` contract — not a bug, just
worth noting since "PET" reads oddly as a selected value until you know it's a code not a label);
the dropdown closed after selection; a mouse click on an option in the pump-code field worked
without the dropdown vanishing first; `Escape` and clicking outside the input both closed the
dropdown without altering the value. Screenshots taken at each step, kept in the session scratch
directory (not committed — throwaway verification artifacts, not project deliverables).

**Verification performed this session:** `npm run typecheck` clean, `npm run lint` clean (after
fixing the one `set-state-in-effect` finding above — a genuine, correctly-flagged issue, not a
false positive dismissed), `npm run build` clean (21 web routes, unchanged — component rewrite only,
no new routes). `npm run test`: **one transient failure on the very first run right after the
Combobox change** — traced to a stale SQLite file lock left by a just-`Stop-Process`-killed dev-API
process (same class of issue Session 6 flagged: forcibly killing `tsx watch` doesn't always release
the file handle instantly). Reran twice immediately after with zero other changes: 73/73 both times,
confirming it was a timing flake from process cleanup, not a real regression — noted here rather
than silently ignored, since "reran and it passed" always deserves a stated reason, not just being
memory-holed as noise. The full offline-sync and Combobox browser verification is detailed in Parts
2–3 above.

**State:** offline-sync verification left no residue (test bills cancelled, `OFFLINEMODE` reverted,
dev servers stopped, ports 3000/4000 confirmed free). Combobox change is a pure component-file
rewrite with no data-layer or schema impact. Not yet committed as of this write-up — see the actual
end-of-session action for whether/how it got committed.

**Next task:** none prescribed. If resuming from here: the WhatsApp invoice module PDF is still
sitting untracked and unstarted, and is probably the most concrete "next feature" waiting on a
decision, per the options offered (and not chosen) at the start of this session.

**Notes for the next session:**
- **`playwright-core` + a system Chrome/Edge `executablePath` is now a confirmed-working recipe**
  for real browser verification in this environment when `chromium-cli` isn't installed. Worth
  writing up as an actual project skill (`/run-skill-generator` was suggested by the `run` skill's
  own guidance for exactly this situation — a fallback pattern that worked but required
  installing a package and writing a driver) rather than re-deriving it from scratch next time.
- **The root `"dev"` npm script is broken on Windows** (only starts the API — see Part 2's
  explanation of `cmd.exe`'s `&` semantics vs bash's). Not fixed this session, flagged instead. A
  real fix likely wants `concurrently` (or similar) rather than the shell-native `&`/`&&` a
  cross-platform script needs to avoid.
- The Combobox's 50-row cap and substring-only matching (no fuzzy match, no relevance ranking) are
  simple-by-design choices appropriate for master-data lists in the tens-to-low-hundreds; revisit
  if any list this feeds ever grows into the thousands.

### 2026-07-29/30 — Session 16 (WhatsApp Invoice Module, Community edition)

**Context:** picked up the one concrete "next feature" flagged at the end of Session 15 — the user
said to go ahead with `PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf`, a module brief that had
been sitting in the repo root, untracked, since before Session 14. Read it in full before writing
any code (three pages: Objective, Community Edition Phase 1, Professional Edition Future,
Architecture, Customer Experience, Configuration, Communication Log, Validation, UI, Development
Requirements). Built exactly Phase 1 as scoped, architected but did not implement Phase 2.

**What the brief asked for, and what was built against each point:**
- *"After bill generation show: Print, Download PDF, Send to WhatsApp."* — added a "Send Invoice"
  button (`components/SendInvoiceButton.tsx`) alongside the existing "Print Bill" button, in both
  places the billing page already shows an invoice: right after creating one, and when looking an
  existing bill back up via the lookup section (not shown for a cancelled bill — sending an
  invoice for a cancelled sale doesn't make sense). Did not touch or restructure the existing
  Print Bill button/`downloadAuthed` flow, per "without changing existing billing logic."
- *"If a registered customer is selected, use the WhatsApp/mobile number from Customer Master."* —
  `customers.phone` already existed (Session 1); reused it rather than adding a separate
  `whatsapp_number` column. For a Credit sale, the billing page already loads full `Customer` info
  into `customerInfo` for its due/credit-limit panel — snapshotted into a new `invoiceCustomer`
  state *before* `resetForm()` clears it (the existing post-submit reset happens synchronously
  right after `setInvoice(result)`, so without this snapshot the phone number would already be
  gone by the time the invoice success box renders). For the bill-lookup path, the `Bill` type only
  carries `customer_code`, not phone/name, so `handleLookup()` now does a follow-up
  `api.getCustomer()` fetch — tracked as `Customer | null | undefined` (undefined = still
  resolving) specifically so `SendInvoiceButton` doesn't mount with a stale empty number while
  that fetch is in flight; see the useEffect/lint note below for why this mattered.
- *"If no customer is selected, prompt the operator to enter a mobile number... allow operator to
  edit the number before sending."* — for cash/UPI/card sales, the billing page has no customer
  field at all today (only Credit shows one — Session 13's master-detail rework), so
  `customerPhone` is simply undefined for those and the mobile-number field in
  `SendInvoiceButton`'s confirm step starts empty, always editable regardless of source.
- *"Generate/reuse the invoice PDF, open WhatsApp Web (wa.me) with a pre-filled thank-you message,
  then display a notice asking the operator to attach the generated PDF manually. Do not use
  browser automation or unofficial WhatsApp automation."* — `WhatsAppCommunityProvider.send()`
  builds `https://wa.me/{number}?text={encoded message}`, calls plain `window.open()` (no
  automation library, no headless-browser driving of WhatsApp itself — this is the literal
  deep-link mechanism, the same URL a person could type into their address bar), and separately
  triggers a PDF download (`downloadAuthed`, reusing the existing `/bills/:billNo/pdf` route
  rather than adding a new one — "reuse", not regenerate-differently) so the file is sitting in
  Downloads for the operator to attach by hand. The result message says exactly that: "attach the
  downloaded invoice PDF before sending."
- *"Provider-based communication architecture... WhatsApp Business API, Email, SMS... left as
  'Coming Soon' but fully architected."* — `lib/communication/types.ts`'s `ICommunicationProvider`
  interface (`channel`, `label`, `isAvailable()`, `send()`) is implemented by
  `WhatsAppCommunityProvider` and `SharePdfProvider` for real, and by one shared
  `ComingSoonProvider` class (parameterized by channel + label) for `whatsapp_business`/`email`/
  `sms` — same interface, `isAvailable()` always `false`, `send()` always resolves
  `{success:false, message:"X is coming soon"}`. `CommunicationService` (Billing ->
  CommunicationService -> Provider, per the brief's own architecture diagram) holds one instance
  of each, keyed by channel, and is what actually gets called from `SendInvoiceButton` — logging
  to the backend is centralized there (one `api.logCommunication()` call per send, regardless of
  which provider handled it), not duplicated per-provider.
- *"CommunicationLog model and CommunicationResult model... Store InvoiceId, CustomerId, Mobile
  Number, Channel, Status, Date/Time and Remarks."* — new `communication_log` table
  (`repositories/communicationLog.ts`), one row per send attempt across every channel. Community
  edition only ever writes `whatsapp`/`share_pdf` rows in practice, but the schema and repo don't
  special-case that — a future Professional-edition provider just starts writing real rows through
  the same path with no schema change needed.
- *"Settings > Communication with Enable WhatsApp, Default Country Code, Message Template, Auto
  Open WhatsApp and Future Business API toggle."* — new `communication_settings` singleton table
  (same one-row-per-deployment pattern as `tenants`/`fin_years`), new section on the existing
  `/settings` page (`CommunicationSection`, placed right after `OperationalFlagsSection`). The
  Business API toggle is rendered but visibly disabled/greyed with a "Coming soon" label — the
  column (`business_api_enabled`) exists in the schema for forward compatibility, but nothing
  reads it; flipping it would currently do nothing, which is honest given there's no real provider
  behind it yet.
- *"Validate mobile number, PDF generation, popup blocking and missing customer details."* —
  `lib/communication/mobileNumber.ts`'s `normalizeMobileNumber()`/`isValidMobileNumber()` (bare
  10-digit numbers get the default country code prepended; anything shorter is rejected as
  implausible). PDF generation failures inside the WhatsApp send path are caught and treated as
  non-fatal (WhatsApp Web still opened; the operator can fall back to the existing "Print Bill"
  button). Popup-blocking detection is real (`if (!win) return {success:false, ...}`) but its
  true-vs-false-positive accuracy couldn't be fully verified this session — see the bug/false-lead
  note below. Missing customer details just means an empty confirm-step field, handled by the
  existing required-before-send validation.
- *"Generic 'Send Invoice' button with channels: WhatsApp (active), Email (future), SMS (future),
  Share PDF."* — exactly this: WhatsApp and Share PDF are clickable, Email/SMS render with a
  "Coming soon" badge and `disabled`, not hidden — so the eventual Professional-edition upgrade
  path is visible to whoever's using the app today, not a surprise later.

**One real bug found, and one false lead corrected, both via actual browser testing (not just code
review):** first implementation passed `window.open(url, "_blank", "noopener,noreferrer")` — the
conventional pairing for "open a new tab safely." Testing it live showed the result message always
said "popup blocked" even when the tab visibly opened successfully (captured via Playwright's
`context.on("page")` listener showing the real `wa.me`/`api.whatsapp.com` URL). Initial diagnosis:
blamed `noopener` specifically, since some browsers are documented to return `null` from
`window.open()` when it's set — removed `noopener` from the features string, kept the same
security property by setting `win.opener = null` by hand right after opening instead. Retested:
**same failure, unchanged.** That disproved the specific diagnosis, so before accepting defeat,
wrote a from-scratch, three-line repro (`page.setContent()` with a plain button and
`window.open()`, no PetroPro code involved at all) — confirmed this exact Playwright + system-Edge
combination returns `null` from `window.open()` **regardless of whether `noopener` is present**,
even for a same-task, direct-click, no-app-code call. So the actual root cause is an
automation/engine-specific quirk of this test harness, not anything in the app. Kept the
`win.opener = null` change anyway (it's still the objectively better technique for real,
non-automated users — same security property, no engine-dependent return-value risk), but
corrected the code's own comment to stop asserting a causal claim ("confirmed via real browser
testing") that the follow-up repro had actually disproven. Recorded plainly here and in `Todo.md`
that the popup-blocked-vs-success *distinction* itself remains unverified by automation for this
reason — everything else about the send flow (URL construction, message rendering with real
tenant/bill data, mobile number normalization, the confirm-step UX) was verified for real.

**A second, smaller lint-driven fix, same class as Session 15's Combobox one:** `SendInvoiceButton`
initially synced its local `mobile` input state from the `customerPhone` prop via
`useEffect(() => setMobile(customerPhone ?? ""), [customerPhone])` — flagged by
`react-hooks/set-state-in-effect` again. Fixed the same way as the Combobox: dropped the effect,
initialize `mobile` from the prop once (`useState(customerPhone ?? "")`), and key the component by
bill number at both call sites in `billing/page.tsx` so a new bill/lookup remounts it fresh instead
of needing prop-change-triggered state syncing. This surfaced a real related timing question for
the lookup path specifically: `lookupCustomer` resolves *after* the initial render (an async
`getCustomer()` call), so keying by bill number alone wasn't enough — `SendInvoiceButton` would
still mount once with `customerPhone` undefined before the fetch resolved, and (correctly, per the
lint fix) never re-sync afterward. Fixed by tracking `lookupCustomer` as `Customer | null |
undefined` (undefined = still resolving) and not rendering `SendInvoiceButton` for the lookup
result until it resolves either way — a couple hundred milliseconds' delay before the button
appears, not a bug, just an honest reflection of the async fetch it depends on.

**Verification performed this session:** `npm run typecheck`/`lint`/`build` all clean throughout
(21 web routes, unchanged). 5 new backend tests (`communicationSettings.test.ts`,
`communicationLog.test.ts`) — 78 total (was 73). Real browser verification via the same
`playwright-core` + system Edge recipe Session 15 established: logged in, opened Settings >
Communication and confirmed the message template loaded from the real seeded default; created a
cash bill; clicked Send Invoice → WhatsApp with no known customer number → confirmed the confirm
step appeared (proving the "prompt for a number" requirement); typed a number, clicked "Open
WhatsApp" → captured the real new-tab URL and confirmed the phone number was correctly
country-coded (`9876543210` typed → `919876543210` in the URL) and the message template rendered
with the real tenant name (`SRINIVASA AGENCIES`, from Session 13's imported Srinivasa Agencies
data), the real bill number, and the real amount, all substituted correctly. Confirmed via a direct
`GET /communication/log` call that the send attempt was persisted with the exact result message
shown in the UI. One `npm run test` pass showed 2 failures in `backup.test.ts`/`dataReset.test.ts`
(`pruneOldBackups` count mismatch, an `ENOENT` on a backup file) — reran those two files together
in isolation (both passed) and the full suite twice more (78/78 both times), confirming a
pre-existing race over a shared OS-temp `backups/` directory across parallel test-file processes,
not a regression introduced this session — neither of those test files or the code they exercise
was touched.

**State:** cancelled the 3 test bills created during verification (`45451`–`45453`) so the real
Session 11 demo dataset stayed clean; left the resulting `communication_log` rows in place (no
delete endpoint exists for logs anywhere in this app — `audit_logs` is the same, treated as
append-only across every session). Dev servers stopped, ports 3000/4000 confirmed free.

**Next task:** none prescribed. Phase 2 (Professional edition — a real WhatsApp Business API
integration, Email, SMS) is architected but not implemented; picking it up means replacing
`ComingSoonProvider` instances with real ones behind the same `ICommunicationProvider` interface,
which shouldn't require touching `CommunicationService`, `SendInvoiceButton`, or the backend
`communication_log`/`communication_settings` shape at all — that's the point of the interface.

**Notes for the next session:**
- The popup-blocked-vs-success distinction in `WhatsAppCommunityProvider` could not be verified
  true-vs-false-positive by automation in this environment (see the bug/false-lead writeup above)
  — only a real, non-automated click-through would settle it conclusively, if that ever becomes
  available.
- `docs/MODULES.md` was not updated — this is a genuinely new capability, not a legacy-menu-item
  gap, so there was nothing there to cross-reference, but it's the one doc this session left alone.
- No `.env.example` still exists — flagged in Sessions 14 and 15 too; nothing this session added
  needs one (no new env vars), but it remains a real, accumulating gap.
