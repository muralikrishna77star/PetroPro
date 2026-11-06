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

### 2026-08-04 — Session 17 (QR-code invoice sharing, Community edition)

**Context:** user asked, given the outlet already has a payment QR code, whether a customer could
scan a QR code and get their bill onto their own phone — "any easy way with the community
edition." Since WhatsApp can't be made to proactively deliver a message to an arbitrary number
without the Business API (explicitly out of scope for Community edition per Session 16's brief),
asked the user to choose between three feasible flows before building anything: (1) a public,
token-gated invoice link that the customer's own phone opens directly, with a one-tap share into
WhatsApp; (2) a QR that opens WhatsApp on the customer's phone pre-addressed to the shop asking
for the bill, requiring a manual staff reply; (3) a QR that opens WhatsApp's contact picker with
the invoice link as the message body. User picked option 1.

**Last completed task:** the public invoice-link flow, backend and frontend.

- `plugins/auth.ts`: new `InvoiceTokenPayload` (`role: "invoice"`, `sub` = bill number as a
  string) — a third JWT audience alongside the existing staff (`AuthTokenPayload`) and customer
  (`CustomerTokenPayload`) ones. Added to the `FastifyJWT` payload/user union.
- `routes/bills.ts`: `GET /bills/:billNo/share-link` (any signed-in staff — same gate as the
  existing PDF route) signs one with a 30-minute `expiresIn` (`SHARE_LINK_TTL`) and returns
  `{ token, url, expiresInSeconds }`, `url` pointing at `${config.webAppUrl}/i/:billNo?t=...`.
- New `routes/publicInvoice.ts`, registered in `app.ts` with **no** `authenticate`/`requireRole`
  preHandler at all: `GET /public/invoice/:billNo` and `GET /public/invoice/:billNo/pdf`. A local
  `checkToken()` helper calls `fastify.jwt.verify<InvoiceTokenPayload>(token)` directly on the
  query-string `t` param (not `request.jwtVerify()`, since there's no Authorization header when a
  phone camera opens a bare URL) and additionally checks `payload.sub === String(billNo)` — a
  token minted for bill 100 must 401 against bill 101, not just any valid-looking token working
  for any bill.

**Real bug found and fixed while wiring this up, before it shipped, not after:** adding
`"invoice"` to the JWT payload union broke `requireRole`'s TypeScript check (`Role[]` can't
accept `"invoice"`), and tracking that down surfaced that `fastify.authenticate` — used by
several staff-only `GET /bills/*` routes including the brand-new `/bills/:billNo/share-link` —
only ever checked that the JWT verifies, never that its role is actually staff. Before this fix, a
QR-scanned invoice token (or, it turns out, an existing customer-portal token — this gap
predates this session) could hit any `authenticate`-gated route directly: in particular, calling
the new share-link endpoint with an invoice token for bill 100 could mint a *fresh* share-link for
bill 101, escalating a single scanned QR into read access to every bill in the system within that
token's 30-minute window. Fixed by making `authenticate` explicitly reject `"customer"`/
`"invoice"` roles, the same way `requireRole` already did — not a new mechanism, just closing the
one decorator that had been left permissive. Verified directly over HTTP (below), not just by
code review.

- `SendInvoiceButton.tsx`: third dropdown action, "Customer scans QR" — calls the new
  `api.getShareLink()`, renders the returned URL as a QR image via the `qrcode` npm package
  (new `apps/web` dependency, client-side `QRCode.toDataURL()`, no network round-trip beyond the
  share-link fetch itself), with a "Copy link" fallback for anyone without a camera handy. Same
  `token`/`billNo` props the component already had — no changes needed at either of its two call
  sites on the billing page.
- New `apps/web/app/i/[billNo]/page.tsx` — a public route with no `(app)` layout, no session of
  any kind (doesn't touch `lib/auth.ts` or `lib/customerAuth.ts`). Reads `billNo` from the route
  param and `t` from `window.location.search` (matching `app/login/page.tsx`'s established
  reasoning for not using `useSearchParams()` — avoids an unnecessary Suspense boundary), fetches
  `/public/invoice/:billNo`, and renders a mobile-first card: tenant letterhead, a cancelled-bill
  banner where applicable, line items, totals, amount in words, a plain PDF download link (the
  token is in the URL, not an Authorization header, so an ordinary `<a href>` works — no
  `downloadAuthed()` needed here), and a Share button (Web Share API with a file attachment where
  supported, falling back to a plain download — the same pattern `SharePdfProvider` already uses,
  reimplemented standalone since this page has no staff token to reuse that helper with).
- `packages/shared-types`: `ShareLinkResponse`, `PublicInvoice` — wire shapes for the two new
  endpoints; `apps/web/lib/api.ts` gained `api.getShareLink()` (staff-authenticated) and a new
  `publicApi` object (`getInvoice`, `invoicePdfUrl`) that deliberately bypasses `request()`'s
  Authorization-header plumbing since there's no staff/customer token in this flow at all.

**Verification performed this session:** `typecheck`/`lint`/`build` all clean across all three
workspaces (`/i/[billNo]` builds as a dynamic route, 22 web routes total, up from 21). Full test
suite still 78/78 — no new repository/service logic was added (this was routing, an auth-plugin
fix, and frontend work), so no new test files were warranted. Ran a real HTTP pass against a
running dev server: created a live cash bill, minted a share-link for it, fetched
`/public/invoice/:billNo` with the token and confirmed the correct bill/tenant/line-item/total
data came back, fetched `/public/invoice/:billNo/pdf` and confirmed via `file` it's a real
single-page PDF, confirmed the *same* token against a *different* bill number 401s, confirmed no
token and a garbage token both 401 with the same user-facing message. Then specifically verified
the security fix: the invoice token gets 403 from the staff-only `/bills/recent` and from trying
to mint a share-link for a bill other than its own, while a normal staff token is completely
unaffected on both of those same routes. Cancelled the one test bill created during verification
afterward.

**Not verified:** no physical phone or camera was available in this environment to actually scan a
rendered QR code and watch `/i/[billNo]` render in a real mobile browser — the link the QR encodes
was verified to work correctly end-to-end via curl, and the QR image itself is generated by a
widely-used library (`qrcode`) rather than anything custom, but the true "point a camera at the
screen" path is unverified, same category of gap as every other real-device-only check flagged in
this project's history.

**State:** dev API server was stopped at end of session (port 4000 confirmed free). The one test
bill created during verification was cancelled, not deleted — consistent with how every prior
session has handled test data, since there's no delete endpoint for bills (only cancel) anywhere
in this app.

**Next task:** none prescribed. If a real phone/camera becomes available in a future session,
finishing the verification above (actually scanning a QR code and confirming the page renders
correctly on a real mobile browser) would be the natural next step for this specific feature.

**Notes for the next session:**
- The `fastify.authenticate` fix (rejecting `"customer"`/`"invoice"` roles) is general hardening,
  not QR-specific — worth remembering if a future session adds yet another JWT audience, since the
  same gap would reopen for it unless `authenticate` keeps explicitly allow-listing staff roles
  rather than just checking "is this JWT valid at all."
- The 30-minute share-link TTL (`SHARE_LINK_TTL` in `routes/bills.ts`) is a judgment call, not
  something the user specified — easy to change if it proves too short (a customer who steps away
  and comes back later) or too long (extends the window a leaked/screenshotted link stays live) in
  practice.

### 2026-08-04 — Session 18 (Customer Master phone capture — WhatsApp invoice fix)

**Context:** user reported that for Credit Bills, the Send Invoice button's WhatsApp option
should reach the customer's "designated whatsapp number... captured from the customer master."

**Investigation before writing any code:** read `SendInvoiceButton`, `WhatsAppCommunityProvider`,
and `billing/page.tsx` again — the pre-fill/auto-open logic for credit sales (customer's `phone`
→ `SendInvoiceButton`'s `customerPhone` prop → initial `mobile` state → auto-opens wa.me if
`auto_open_whatsapp` is on, the default) was already correct and unchanged since Session 16. Then
checked `app/(app)/customers/page.tsx` directly: **no `phone` field appears anywhere in that file**
— not in the create-customer form, not in the customer detail/edit panel — despite
`customersRepo.create`/`update` (`repositories/customers.ts`) and `PUT /customers/:code`
(`routes/customers.ts`) both fully supporting `phone` since Phase 1, with the `?? null` fallback
pattern already correctly in place. So every credit customer's `phone` was always null in
practice — not a WhatsApp-module bug, a missing master-data field in the UI in front of it. This
is the kind of thing worth stating plainly to the user rather than silently "fixing WhatsApp":
the WhatsApp send logic was never broken, there was just never a way to give it a number to use.

**Last completed task:** gave Customer Master an actual way to capture and edit a phone number.

- `apps/web/lib/api.ts`: `createCustomer`'s body type gained `phone?: string` (backend already
  accepted it; only the frontend's type/call site didn't send it).
- `app/(app)/customers/page.tsx`: the create-customer form gained a "WhatsApp / mobile number
  (optional)" input. The customer detail panel gained a new edit block, "WhatsApp / mobile
  number," directly under the customer's name/due/credit-limit header — same shape as the
  existing "Order Entry login" email editor (`handleSavePhone`, mirroring `handleSaveEmail`
  exactly: spread `...selected`, override the one field, `PUT /customers/:code`), gated to
  `super_admin`/`owner` to match the backend's role gate on that route precisely (an `operator`
  can view but not edit, consistent with how credit limits and opening balances are already
  restricted on this same page). The header line now also shows the number inline once one is
  set, so it's visible at a glance whether a given customer has one on file at all.

**Verification performed this session:** `typecheck`/`lint`/`build` all clean (still 22 web
routes — this only added fields to an existing page, no new route). Full test suite 78/78 — no
backend logic changed, so no new tests were warranted. Ran a real HTTP pass against a running dev
server using the frontend's exact payload shapes: created a credit customer
(`{code, name, credit_limit, phone}`, matching the new create-form's body) and confirmed `GET`
returned the phone; updated it via the edit-panel's full-object `PUT` shape (spreading the
existing customer plus the new phone) and confirmed the new value persisted; then, to prove the
number is actually reachable through the real credit-billing path and not just stored inertly,
created a real credit bill against that customer and confirmed `due_amount` moved correctly,
cancelled it, and confirmed `due_amount` reversed back to 0. Did **not** re-verify the WhatsApp
send mechanism itself (wa.me URL construction, country-code prefixing, template rendering,
auto-open) — none of that code was touched this session, and it was already verified for real
(Playwright + system Edge) in Session 16; re-testing unchanged code wouldn't have added signal.

**State:** dev API server stopped, port 4000 confirmed free. Cancelled the one test credit bill
created during verification. Left the throwaway test customer (`QRTEST1`) in place — there is no
delete endpoint for customers anywhere in this app (matches how other master-data entities in
this codebase are deactivated/left alone rather than deleted, e.g. users), so removing it wasn't
an available option; it's harmless (zero due amount, no other side effects).

**Next task:** none prescribed — this was a direct, scoped response to a user-reported gap, not
part of an open punch list.

**Notes for the next session:**
- Phone editing is admin/owner-only in the UI (matching the backend), so an `operator` — who is
  usually the one actually clicking Send Invoice day to day — can't correct a wrong or missing
  number themselves; they'd have to ask an admin/owner. Worth revisiting if this turns out to be
  real friction in practice, but not changed here since it wasn't asked for and the backend route
  itself would need a role-gate change too, not just the frontend.
- The user's phrasing was "designated whatsapp *numbers*" (plural) — treated as phrasing, not a
  request for multiple recipients per customer, since the schema (`customers.phone`, one column)
  and every part of the existing WhatsApp flow only ever assumed one number. If the user actually
  wants multi-recipient support (e.g. owner + accountant both notified), that's a real schema
  change (a `customer_contacts` table or similar), not a small follow-up — flag and confirm scope
  before building it rather than assuming.

### 2026-08-13 — Session 19 (env var documentation) — reconstructed

**This entry was not written at the time.** Sessions 19 and 20 landed as commits (`2c2400a`,
`e7354cc`) with no matching handoff/Todo entries — the same gap Session 14 flagged about the
pre-Session-14 sessions, now recurring. Reconstructed from `git show` on each commit during a
later session; no first-hand verification record exists for either, so none is claimed below
beyond what the diffs themselves prove.

**Context:** "no `.env.example`" had been a flagged gap since Session 14, repeated in Sessions
15–18's "notes for the next session" each time — neither app documented the growing list of env
vars `config.ts` reads on either side.

**Last completed task:** `apps/api/.env.example` (every var `apps/api/src/config.ts` reads:
`PORT`, `HOST`, `JWT_SECRET`, `DB_PATH`, `API_PUBLIC_URL`, `WEB_APP_URL`, and the three optional
Google Sign-In vars — `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI`,
documented as safe to leave blank, which disables the feature rather than erroring) and
`apps/web/.env.example` (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_SSO_ENABLED`). Each file notes
its local-dev default inline plus where the production equivalent is actually set (Fly.io secrets
for the API, Vercel project env vars for web). Also added `!.env.example` to
`apps/web/.gitignore`'s blanket `.env*` rule — without it the new file would have been silently
gitignored and never actually committed (the API side has no such blanket rule, so needed no
equivalent fix).

**Gap found while reconstructing this entry, not caught at the time:** `apps/web`'s
`.env.example` didn't include `NEXT_PUBLIC_DESKTOP_CONTROL_PORT`, which
`components/DesktopTitleBar.tsx` reads (defaults to `4098`) to reach the desktop kiosk launcher's
local control server. Fixed directly rather than just flagged, since it's a one-line omission in
the exact file this session's whole purpose was to make complete. Still undocumented anywhere:
`scripts/desktop/start.mjs`'s own `API_PORT`/`WEB_PORT`/`DESKTOP_CONTROL_PORT` (no `NEXT_PUBLIC_`
prefix — read directly by that Node script, not by either Next.js/Fastify app), since that script
lives outside both workspaces and has no `.env.example` of its own today.

**State:** documentation-only; no application code touched by the original commit.

**Next task:** none prescribed — this closed a standalone flagged gap.

### 2026-08-13 — Session 20 (Billing/Reports polish) — reconstructed

**Same caveat as Session 19 above** — reconstructed from commit `e7354cc`, not logged at the time.

**Last completed task:** three small, unrelated polish items in one commit:
- Billing page header retitled "Walk-in Billing" → "Just Billing"; Sale Type button order changed
  from Cash/UPI/Card/Credit to Cash/Credit/Card/UPI (`app/(app)/billing/page.tsx`).
- GST summary Excel export (`services/gstExcel.ts`): Taxable Value/Tax Amount/Total columns now
  carry a `"₹"#,##0.00` `numFmt` instead of exporting raw unformatted numbers.
- Reports page (`app/(app)/reports/page.tsx`): fuel (Petrol/Diesel) quantities are rounded to 3
  decimals everywhere a Qty/quantity column appears, determined by matching the item catalog's
  `name` against `/petrol|diesel/i` (a new `api.listItems()` call on page load) rather than a
  hardcoded item-code list. All numeric table columns are now right-aligned with tabular figures
  (new `isNumericCell`/`isNumericColumn` helpers infer "numeric" from cell shape — a raw number or
  a money/percent/decimal-formatted string — rather than threading column-type metadata through
  every report). The page's own `max-w-4xl` cap was dropped so wide reports (Mileage, HSN) use the
  full width the shared app shell already allows.

**State:** no schema, route, or test changes — pure frontend/formatting; route count and test
count are unaffected (still 22 web routes, 78 tests as of Session 18).

**Next task:** none prescribed.

**Notes for the next session:**
- No verification record exists for this session (see the reconstruction caveat above) — a fresh
  `typecheck`/`lint`/`build` pass would be worth running before trusting these changes deeper than
  a diff read, since none of that is confirmed to have happened at the time.
- The fuel-quantity rounding is name-based (`/petrol|diesel/i` against `items.name`), not a
  dedicated `items.is_fuel` flag. Fine while the catalog's only fuel products are literally named
  "Petrol"/"Diesel"; would silently fall through to unrounded quantities (not error) for a fuel
  product added later whose name doesn't contain either word — e.g. an abbreviated "MS"/"HSD" code
  or a differently-branded fuel line.

### 2026-11-02 — Session 21 (Customer Statement report + QR "send to my WhatsApp" setting)

**Context:** two user requests in one session.
1. "Customer Report for Credit Customers is missing": a from-date/to-date statement that must
   reproduce the legacy FoxPro report forms exactly. The forms are `CWS.FRT` (customer-wise
   statement), `CWSWO.FRT` (with opening balance), and the vehicle-grouped pair `CWSG`/`CWSGWO`.
   They are in `WorkareaTill29Mar2026/`, which is gitignored and local only. Treat it as read-only,
   like `legacy/Workarea/`.
2. The QR-scanned invoice page's "get the bill on WhatsApp" option should be a configuration
   setting, used only when the customer chooses to.

**How the legacy forms were read:**
- FRX/FRT files are DBF tables plus an FPT memo. I dumped them with a scratch script, which is not
  committed:
  - OBJTYPE: 5 text, 8 field, 9 band, 18 variable.
  - Band OBJCODE: 0 title, 1 page header, 3 group header, 4 detail, 5 group footer, 7 page footer,
    8 summary.
  - VPOS/HPOS are absolute row/column positions.
- CWS.PRG itself survives only as the compiled `CWS.FXP`. Its strings still give:
  - the prompts: customer, start/end date, vehicle no., group by vehicle, print opening & closing;
  - the SQL: the customer's bill lines, `BETWEEN` dates, `ORDER BY bill_date, bill_no`, and
    `alltrim(veh_no)=alltrim(vehno)`, which is a prefix match under `SET EXACT OFF`;
  - the message "NO BILLS FOUND ON SPECIFIED RANGE".
- Helper functions:
  - `getname(1..4)` reads HEADINGS.DBF: `CNAME`, `ADDR1`, `ADDR2` and `ADDLINE`. `ADDLINE` is the
    tagline, printed in the page footer.
  - `getbals(1)` is the opening balance as on the start date.
  - `getbals(3)` is receipts in the period.
  - `getnobs()` is the distinct bill count.

**Last completed task — Customer Statement:**
- **`apps/api/src/services/customerStatement.ts` (new).** `getCustomerStatement(opts)` renders the
  report as fixed-width text pages, column for column from the FRX positions.
  - Two layouts: `wideLayout` (CWS/CWSWO, 130 columns × 66 lines) and `groupedLayout`
    (CWSG/CWSGWO, 75 × 65).
  - FoxPro-faithful helpers:
    - `foxRound` rounds half away from zero.
    - `pic()` formats numbers like a FoxPro PICTURE: `@Z` blanks zero, and commas appear only with
      a digit to their left.
    - `Row` writes text as an overlay: padding never erases existing text, character fields are
      truncated to their width, and right-justified fields spill left.
  - `paginate()` builds the pages:
    - the heading line on every page, and the title band on page 1 only;
    - the page footer pinned to the bottom, showing "Balance C/F" only when more rows follow, with
      "Balance B/D" on the next page;
    - an empty group-header row before each vehicle;
    - the summary pushed to a new page if it doesn't fit.
- **Data and totals.**
  - Only credit bills that aren't cancelled, filtered with `date(bill_date) BETWEEN`.
  - The vehicle filter is a case-insensitive prefix match (`LIKE UPPER(?)||'%'`).
  - Opening balance and receipts come from `getCustomerLedger(code, from, to)`.
  - Service charge = round2(total × sc% / 100).
  - Net balance = total + service charge + opening − receipts. The net amount is rounded to the
    rupee and the round-off is shown.
  - Amount in words uses the legacy `moneyWords()`, which gives "Six hundred". The lowercase "h"
    is kept from MONEY.PRG.
- **`apps/api/src/services/customerStatementPdf.ts` (new).** A4 portrait in Courier, with the font
  size fitted to the page width and one PDF page per text page.
- **`routes/reports.ts`.**
  - `GET /reports/customers/:code/statement` (JSON) and `.../statement.pdf`, both manager-only.
  - Query parameters: `from`, `to`, `vehicle_no`, `group_by_vehicle`, `with_opening` (`1` or
    `true`).
  - Returns 400 for bad input or an unknown customer. The PDF route returns 404 "No bills found on
    specified range" when there are no lines.
- **`packages/shared-types`:** `CustomerStatement`, `CustomerStatementQuery`.
- **Web: Reports → "Customer Statement (Credit)".**
  - Controls: customer picker, optional vehicle no., and the **Group by vehicle** and **Opening &
    closing amounts** checkboxes. The four combinations pick CWS, CWSWO, CWSG or CWSGWO.
  - Output: a monospace on-screen preview of each page, plus **Print / PDF** and **Download PDF**.

**Last completed task — QR WhatsApp setting:**
- **Schema.**
  - `communication_settings.qr_whatsapp_enabled` defaults to **0 (off)**, because the option hands
    out a link that lasts days rather than the QR code's 30 minutes.
  - `qr_whatsapp_link_days` defaults to 7. The repository accepts only 1–90.
- **`routes/publicInvoice.ts`.**
  - GET now also returns `whatsapp: {enabled, default_country_code, link_days}`.
  - New `POST /public/invoice/:billNo/whatsapp?t=`.
  - Errors: 401 for a bad token or one issued for another bill, 403 when the setting is off, 404
    when the bill doesn't exist, 400 for a bad number.
  - On success it issues an invoice token valid for `link_days` and returns a wa.me URL to the
    customer's own number carrying the bill link.
  - Each use is logged to `communication_log` with the remark "Customer self-service from QR
    scan". The number is **not** saved to Customer Master.
- **Web.**
  - `/i/[billNo]` shows "Send this bill to my WhatsApp" only when the setting is on. The customer
    enters a number, and WhatsApp opens.
  - Settings → Communication has a "QR scan: send bill to customer's WhatsApp" YES/NO toggle, plus
    the link validity in days.
  - `SendInvoiceButton`'s QR panel mentions the option when it's on.

**Verification performed this session:**
- New tests in `customerStatement.test.ts` (5):
  - CWS totals and column positions;
  - CWSWO opening balance and receipts;
  - the vehicle prefix filter;
  - CWSG per-vehicle totals;
  - 70-bill pagination with the C/F and B/D carry-forward.
- New tests in `routes/publicInvoice.test.ts` (4):
  - off by default, returning 403;
  - when enabled, a wa.me URL, a 10-day token and a log row;
  - a bad number returns 400, and a token for another bill returns 401;
  - link days outside 1–90 are refused.
- The full API suite passes **87/87**. `tsc` is clean for api and web, and eslint is clean on the
  changed web files.
- HTTP checks against a dev server:
  - statement JSON returned 200 (CWSWO, 80 bills, 2 pages);
  - the PDF returned 200 `application/pdf`;
  - an empty range returned 404, and an unknown customer returned 400.
- **Not done:** the PDF was never checked visually (there is no PDF renderer in this environment),
  and neither feature was clicked through in a browser.

**State:** committed as `a6d0e8d` and pushed to `origin/master`. Deployed the same day:
- **API:** `fly deploy --remote-only -a petropro-api`.
  - Note: `fly auth login` needs an interactive terminal, so the user signed in from their own
    VS Code terminal first.
- **Web:** `vercel --prod` from the repo root, which is aliased to `petropro-demo.vercel.app`.
  - Vercel isn't wired to deploy on git push here; web deploys are manual CLI runs.
- **Deploy order:** API first, then web, because the new web screens call API routes that didn't
  exist before.
- **Live checks:**
  - `/health` returned 200.
  - `GET /reports/customers/:code/statement` returned 401, so the route exists.
  - `POST /public/invoice/:billNo/whatsapp` with a bad token returned the expected 401 message.
  - The live Reports bundle contains "Customer Statement (Credit)".
- **Not done on production:** no one has logged in and run a statement or used the WhatsApp
  option there.

**Next task:** the user checks both features in the app, ideally against a real FoxPro printout of
CWS, CWSWO, CWSG and CWSGWO.

**Notes for the next session (assumptions to confirm with the user):**
- The "SALES REPORT OF <customer> From … To …" heading isn't in the FRX files. I inferred that it
  comes from a `REPORT FORM … HEADING` clause in CWS.PRG and placed it as line 0 of every page. Its
  exact position is a best guess.
- The opening balance is the customer's opening balance plus credit bills minus receipts before the
  From date. Service charge on earlier bills is not included.
- Where FoxPro would print `****` for an overflowing number, the number prints in full and spills
  left. Address lines that are too wide are centered rather than truncated.
- The FXP names WOCWS.FRX, but that file isn't in the 2026 workarea. CWS-P is a 78-column print
  variant. Only the four forms the user named were built.
- The user may have meant a per-customer "willing to receive on WhatsApp" flag in Customer Master
  rather than the customer opting in at scan time. If so, that's a follow-up.

### 2026-11-02 — Session 22 (verification pass + amount-in-words bug fix)

**Context:** the user said "just continue". Session 21's open items needed a person, a browser or
real FoxPro printouts, so this session did the parts that could be done here.

**Environment notes:**
- This checkout had no `node_modules` and no `apps/api/data/petropro.db`. Ran `npm ci`.
- `legacy/Workarea/` isn't on disk; it has been untracked since `bc0ce7a`. Legacy PRGs can still
  be read from git history, e.g. `git show bc0ce7a^:legacy/Workarea/MONEY.PRG`.

**Verification pass (closes the Sessions 19–20 gap in `Todo.md`):** `npm run typecheck`,
`npm run lint`, `npm run build` and `npm run test` are all clean.

**Statement PDFs checked visually.**
- Rendered all four forms (CWS, CWSWO, CWSG, CWSGWO) from synthetic data: one customer, 70 credit
  bills, 3 vehicles, an opening balance and a receipt.
- To render them, ran a temporary script with `DB_PATH=:memory:`. The script was deleted
  afterwards.
- These look right:
  - the layout;
  - the B/D and C/F carry-forward between pages;
  - the per-vehicle subtotals;
  - the totals arithmetic.
- On the WO forms, "Grand Total" includes the opening balance, while the service charge is on
  the bill total only. This matches the FRX and is not a bug.

**Bug found and fixed: `services/money.ts` `moneyWords`.**
- The 5-digit, 7-digit and 9-digit branches took the remainder with one zero too many
  (`% 10000`, `% 1000000`, `% 100000000`).
- MONEY.PRG uses `substr(str, 3, n)`, which is only the digits after the 2-digit head.
- Effect: 34,089 printed as "Thirty Four Thousand Four Thousand Eighty Nine".
- Scope: affected every invoice's `amountInWords` from ₹10,000 to ₹99,999, and any amount with
  10–99 lakh or 10–99 crore. That includes invoice PDFs, the cashier, billing and QR pages, and
  statement totals.
- The legacy FoxPro output was correct; only the port was wrong.
- Fix: the remainder is now `% 1000`, `% 100000` and `% 10000000`.
- Two new tests, which fail without the fix. The API suite passes **89/89**.

**State:** committed locally. Not pushed and not deployed; the fix reaches production only after
`fly deploy` of the API.

**Next task:**
- Push and deploy the API with the money-words fix.
- The Session 21 items still need the user: compare against real FoxPro printouts, click through
  in a browser, and decide on the WhatsApp consent model.

### 2026-11-02 — Session 23 (Technology & Subscription Dashboard)

**Context:** the user asked for a Super Admin dashboard covering the technologies PetroPro runs on,
subscription and billing status, and alerts. An uncommitted draft of the API side and part of the UI
was already in the working tree; this session reviewed it, fixed it and finished it.

**What was added:**
- `/technology` page (`apps/web/app/(app)/technology/`): summary cards, recurring cost by currency,
  alerts, a searchable and filterable service list (table from `xl`, cards below), and a details
  panel with the manual record form, provider check and change history.
- API (`routes/techDashboard.ts`, all `super_admin` only): `GET /tech-dashboard`,
  `GET .../services/:id/history`, `PUT`/`DELETE .../subscription`, `POST .../verify`.
- `services/techCatalog.ts`: the technology list, written from the repo. `techCatalog.test.ts` fails
  if its versions, file paths or fly.toml facts drift from the repo.
- Tables `tech_subscriptions` (manual) and `tech_provider_checks` (what an API said), kept apart so
  verified and manually recorded can't be mixed up.

**Decisions:**
- Provider APIs only ever confirm the plan name. Neither Vercel's nor GitHub's documented API used
  here reports payment state, so subscription and billing status are always manual and always
  labelled so. No code path derives a status from a service responding.
- A GitHub plan counts as verified only if the token's account owns the repository
  (`GITHUB_REPO_OWNER`), because `GET /user` reports the token holder's plan.
- Usage-based services count toward recurring cost using the recorded amount as a typical month, and
  are labelled as estimates. Otherwise Fly.io, which bills by usage, would be left out of the total.
- Entries with `entity_type = tech_subscription` are hidden from owners on `GET /audit-logs`. Owners
  can read that log, and these entries contain plans and amounts.

**Bugs found on the way, all fixed:**
- `apps/web/lib/api.ts` `request()` sent a JSON `Content-Type` even with no body, and Fastify answers
  that with 400 `FST_ERR_CTP_EMPTY_JSON_BODY`. This broke **every bodyless POST/DELETE in the app**:
  Cancel Bill in the Billing screen (`api.cancelBill`), rate-change delete, and this dashboard's Clear
  record. API tests use `app.inject` and don't go through this client, so they never caught it.
  Cancel Bill will start working on the next web deploy.
- `apps/web/public/sw.js` answered failed API GETs with the cached `/` HTML and status 200, so
  `request()` resolved with `undefined` when the API was down. It now falls back only for page loads;
  API calls fail normally. Cache bumped to `petropro-shell-v6`, `/technology` added to the shell.
- The app shell had no small-screen mode: a fixed 256px sidebar on every page. Below `md` it's now a
  drawer opened from a menu button in `Header`. Desktop is unchanged.

**Verified:**
- `typecheck`, `lint`, `test` and `build`: see the Session 23 entry in `Todo.md` for the final counts.
- Drove the real app in headless Chrome (playwright-core from the scratchpad, against a throwaway
  `DB_PATH`, not committed): 53 checks across 320, 390, 768, 1024, 1280, 1440 and 1920px, covering
  recording, refusing a pasted secret, clearing, filters, alerts, and the loading, empty, unavailable
  and expired-session states, plus owner access. A separate script failed the service worker's own
  network request and confirmed the failure states.
- **Not verified:** a real Vercel or GitHub API call (no tokens here, so those use mocked responses),
  and the portal links while signed in. Logged out, `github.com/settings/billing` returns 404, though
  GitHub's docs give that URL.

**Environment notes:**
- `npm run seed` seeds correctly, then crashes on its last line under Node 22.13: `db.location` isn't
  a function (`apps/api/src/db/seed.ts:58`). Not fixed; unrelated to this work.
- One `npm run test` run reported a single failure while other commands ran at the same time. Its name
  wasn't captured, and it did not recur in later full runs.

**State:** committed as `03beeee`, merged to `master`, pushed to `origin/master` and deployed on
2026-11-02. Session 22's `moneyWords` fix shipped in the same deploy.
- **API:** `fly deploy --remote-only -a petropro-api`, now release `v9`. Roll back to `v8` if needed.
- **Web:** `vercel --prod` from the repo root, Vercel project `petropro`, now deployment
  `dpl_GoQnDrXZ84vpF3UaMiWuysqqr2g7`. Previous: `dpl_BNaVmEBvr36xwv6728ZPZdfQXTTb`.
- **Live checks:** API health OK, `/tech-dashboard` routes answer 401 signed out, the production
  database file is still in place, the site serves service worker `v6`, and a signed-out visit to
  `/technology` lands on `/login`.
- **Not checked live:** anything needing a signed-in session, including `/technology` itself and Cancel
  Bill. No production password was available.

**Deploy notes for this machine:**
- `flyctl` came from `winget` (`Fly-io.flyctl`), and its install folder may not be on the Bash PATH. The
  Vercel CLI came from `npm i -g vercel`.
- Link with `vercel link --project petropro --yes`. This account also has an unrelated project named
  `web`. The link creates a root `.env.local` holding a `VERCEL_OIDC_TOKEN` and adds `.env*` to
  `.gitignore`. Neither is needed for deploying, so both were removed. Don't keep the `.gitignore` line:
  it would hide future `.env.example` files.
- The Vercel account is on the Hobby plan, which may not suit commercial use. For the user to review.

**Next task:** the user records real account details on `/technology`, and sets `VERCEL_API_TOKEN`,
`VERCEL_TEAM_ID` and `GITHUB_TOKEN` as Fly.io secrets if they want plan verification. Deploy API first,
then web.

### 2026-11-04 — Session 24 (Google Sign-In: account linking and hardening)

**Context:** the user pasted a brief for "Sign in with Google" linked to existing users. **The paste was
cut off mid-sentence in section 2** ("Never trust an email address or User"), so anything after that
hasn't been seen. Google sign-in already existed (Session 14) but didn't meet the brief, so this hardens
it rather than adding it. The old version **is live in production**: the button shows, and its redirect
has no PKCE or nonce.

**What changed:**
- `services/googleOAuth.ts` (new): the flow's protocol and security rules. `routes/googleAuth.ts` is now
  thin. Password login, roles and session JWTs are untouched.
- PKCE (S256), `nonce`, and a signed HttpOnly SameSite=Lax cookie binding `state` to the browser. The old
  `state` was signed but not tied to a browser, which allowed login CSRF.
- The ID token is now validated with `jose`: signature against Google's published keys (found through
  its discovery document), issuer, audience, expiry and nonce, plus `email_verified === true`. Before,
  the code read Google's userinfo endpoint and never checked verification.
- New `users.google_sub` (unique). First sign-in links through a verified email an admin has put on the
  user, and `sub` decides from then on. Unmatched accounts are refused. No user is ever created.
- Changing a user's email drops the link. `DELETE /users/:id/google-link` (super_admin) unlinks, and the
  Users screen shows the link and an Unlink button. The Google id never reaches the browser.
- Audit actions: `google_account_linked`, `google_login`, `google_login_denied`, `unlink_google`.
- The callback route logs at `warn`, so the one-time code stays out of request logs.
- Login screen: "Continue with Google", a loading state, and a specific message for each refusal.

**Decisions:**
- `jose` 6.2.12 rather than hand-written JWT checks. It has no dependencies. Chosen over 6.2.15, which was
  days old at the time.
- First-time linking relies on admin-entered email plus Google's verification. There's no password
  confirmation step or self-service linking yet. The cut-off part of the brief may ask for one.
- The session token still travels in the URL fragment, as before. `router.replace` removes it from history.

**Verified:**
- `typecheck`, `lint`, `build`: clean. API tests 115/115, 14 of them new in `routes/googleAuth.test.ts`.
- Mutation check: removed 16 security rules one at a time. 15 were caught. The 16th (a redundant
  already-linked check) was harmless because `linkGoogle` also refuses, so the check was deleted.
- Real browser (headless Chrome, a throwaway database, a fake Google signing real RS256 tokens and
  enforcing PKCE): 33/33, including refusals, a planted callback link, password login, the Users screen,
  logs holding no code or secret, and 320, 390 and 820px widths.
- **Not verified:** a round trip with real Google, which needs a person's Google account. The harness also
  doesn't exercise the cross-site return from accounts.google.com, where the cookie relies on SameSite=Lax.
  Google's docs advertise S256 PKCE only through the discovery document.

**State:** superseded by Session 25, which changed the linking to require the password.

### 2026-11-04 — Session 25 (password-confirmed Google linking and revocable staff sessions)

**Context:** the user decided first-time Google linking must confirm the PetroPro password, asked for the
non-expiring staff tokens to be replaced, and asked for an email review, tests and a commit, with no
deploy until they've seen a readiness report (`docs/DEPLOY_AUTH_SESSIONS.md`).

**Linking:** the Google callback no longer links anything. An unlinked verified email gets a single-use
`link` ticket, and `POST /auth/google/link` requires that user's password. Five wrong passwords in 15
minutes lock the step, across tickets. A linked user gets a `login` ticket that `POST /auth/google/exchange`
turns into a session, with no password. Recovery is admin-controlled and audited: Reset password, and
Unlink Google on the Users screen. This replaces Session 24's link-on-first-sign-in.

**Sessions (`services/sessions.ts`, `auth_sessions`):**
- Access JWTs last 15 minutes and carry a `sid`. Refresh tokens rotate, are stored only as hashes, and
  last until 7 days idle or 30 days old. All configurable: `ACCESS_TOKEN_TTL_SECONDS`, `SESSION_IDLE_DAYS`,
  `SESSION_ABSOLUTE_DAYS`.
- `authenticate` and `requireRole` check the session and user in the database on every staff request, so
  revocation is immediate and a role change applies from the next request.
- Deactivation and password reset revoke all of a user's sessions. Sign-out revokes that one.
- The refresh token's previous value works for 2 minutes, for tab races and lost replies. An older one
  later ends the session as suspected theft.

**Why the proxy:** web and API are on different domains, and browsers block third-party cookies. So
`/session-api/*` on the website rewrites to `/auth/*` on the API (`next.config.ts`), making the HttpOnly
SameSite=Strict refresh cookie first-party. Vercel's own behaviour can only be confirmed after a deploy.
Docker needs `API_INTERNAL_URL`, set in `docker-compose.yml` (not run: no Docker here).

**Client:** `authedFetch` in `lib/api.ts` sends the newest token and renews once on a 401, with one renewal
at a time across tabs. Pages keep passing `session.token`, which it treats only as a fallback. Customer and
QR tokens aren't affected. Only a definite 401 from renewal signs anyone out, never being offline.

**Bug fixed: the offline queue deleted a sale on any API error**, including 401 and 5xx. With 15-minute
tokens that would have become routine. It now keeps entries on 401, 408, 429 and 5xx. Old tabs still have
the old behaviour, hence the runbook's "check nothing is queued" step.

**Email review not done:** the read of production data was blocked by the permission system, and wasn't
worked around. `npm run audit:user-emails -- --fly-app petropro-api` (in `apps/api`) does it, read-only,
for the user to run. The `--fly-app` path itself hasn't been run; the local path has.

**Verified:**
- `typecheck`, `lint`, `build`: clean. API tests: see `Todo.md`.
- Mutation check: 26 new security rules removed one at a time, all caught, after adding one missing test.
  If a run looks odd, `assert.ok` failures here can cancel a whole file (`# fail 0` but the file is `not ok`).
- 51/51 browser checks on a production build of the web app, with a real API and a fake Google, including
  the cookie through the proxy locally, two tabs renewing, two devices, deactivation, expiry, the offline
  queue on the attendant screen, 13 staff screens and the customer portal.
- **Not verified:** real Google, the cookie through Vercel, and the Billing screen's bill queue in a browser
  (it shares `isFinalRejection` with the attendant queue that was tested).

**Known gaps, left alone:**
- Customer portal tokens still never expire.
- Password login has no attempt limit (only the Google link step has one).
- A temporary password has no forced change, and staff have no self-service password change.
- Restoring a backup restores the sessions as they were then.

**State:** committed as `56ec51e`, merged to `master`, pushed and deployed on 2026-11-04, around 12:20 IST,
by `docs/DEPLOY_AUTH_SESSIONS.md`. The user confirmed the email review, backup and device checks beforehand.
- **API:** release `v10`. Roll back to `v9`. The process was stopped for about 6 seconds (Fly logs: SIGINT at
  06:50:13Z, listening at 06:50:19Z).
- **Web:** `dpl_GeBGePUCRvgfBNQ4CnmdBVfPuwNj`, promoted 22 seconds after the API was up. Previous:
  `dpl_GoQnDrXZ84vpF3UaMiWuysqqr2g7`.
- **Live checks, signed out only:** API health, new routes answering, Google redirect has PKCE and nonce,
  the refresh route through Vercel returns 401 with the correct cookie attributes, an old-style session is
  sent to sign in, and no errors logged.
- **Not checked live, needs a real login:** the refresh cookie actually being kept through Vercel, renewal
  after 15 minutes, a real Google sign-in, linking, Cancel Bill, deactivation.

**Network note:** from the development machine, requests straight to `petropro-api.fly.dev` time out about
a third of the time, and IPv6 to it failed every time. `fly.io` itself behaves the same from there, and it
began before the restart, so it isn't this release. Requests through Vercel succeeded 8 out of 8. Browsers
call the API directly for everything but session routes, so check this if the station's connection is the same.

Git note: the saved GitHub login's name is lowercase. Pushing with a capitalized username in the URL makes
Git Credential Manager wait for a sign-in forever, and it holds any pipe open.

### 2026-11-04 — Session 26 (wider Utilities input screens)

**Context:** the user asked for more width on the input screens under Utilities, and chose the workspace's
existing cap (1072px on large monitors) over filling the whole workspace.

**Changed:** Users, Audit Logs and Settings went from 640-736px to `max-w-6xl`, which is the same cap as Billing
and Customers. The Tech & Subscriptions panel went from `max-w-2xl` to `max-w-4xl`. Company Profile fields sit in
two columns from `md`, and its Save button is no longer full width. The Pumps form's name field gained `min-w-0`,
because its Add button ran off the screen on a phone (older than this change).

**Verified:** typecheck and lint clean. In Chrome at 1920, 1366, 768 and 390px on a scratch database: no sideways
overflow, no page errors, adding a user and saving the Company Profile both work.

**State:** committed as `0de9c56`, merged to `master`, pushed and deployed on 2026-11-04, around 19:28 IST. Web
only, so the API didn't restart.
- **Web:** `dpl_58cTFY9a8wYtWvhwbc3xpG46ggn7`. Previous: `dpl_GeBGePUCRvgfBNQ4CnmdBVfPuwNj`.
- **Live checks, signed out only:** the live JavaScript contains the new layout and not the old width, the pages
  answer 200, API health is 200, and the refresh route through Vercel answers 401.
- **Not checked live, needs a real login:** the screens themselves on production.

**Deploy note:** `vercel deploy --prod --yes` needed an explicit allow rule in Claude Code's permissions. A chat
approval doesn't lift that block. The user added the rule, and it stays until they remove it. A user's report of a
deploy should be checked against the live site: the first attempt here hadn't reached production.

### 2026-11-04 — Session 27 (uploading legacy Petbill files)

**Context:** the user wants old Petbill data imported by uploading monthly `DECBIL25.DBF` and `DECSTK22.DBF`
files and annual `PURCH25.DBF` and `RECPT26.DBF`, whose suffix is a calendar year and changes each year, with
purchases picked up from the last one made.

**Built:** Utilities → Legacy Import, Super Admin only: `services/legacyImport.ts`, `routes/legacyImport.ts`,
`parseDbf` in `dbf/reader.ts`, `app/(app)/legacy-import/page.tsx`. No schema change. The raw file is the request
body, limited to 32 MB. The rules and their reasons are in `docs/MIGRATION_NOTES.md`. `CLAUDE.md` and the data
dictionary called the suffix a financial year, and are corrected.

**Verified:** API tests 168/168. 32 deliberate
breaks were all caught, one only after adding a case. Real browser against a production build on a scratch
database: all checks pass, including re-upload, wrong names, and phone width. A 60,000-row file (7.2 MB, about
13 times a real month) took about 6 seconds to preview and 8 to import on this machine. The API can't answer
during that, so large batches belong in a quiet period.

**Not verified:** real Petbill files, as none are on this machine (`legacy/Workarea/` and
`WorkareaTill29Mar2026/` are absent). Older files may have different columns, which the screen would report.

**Later:** real 2019 files turned up in git history and passed. See `docs/MIGRATION_NOTES.md`.

**State:** deployed with Session 28, see below.

### 2026-11-04 — Session 28 (thermal bill printing)

**Context:** the user asked for Petbill's bill printing to be migrated to 80 mm ESC/POS printers, with print,
preview, reprint, PDF, test print, settings per terminal, and a local bridge. Everything is in
`docs/THERMAL_PRINTING.md`: legacy analysis, field mapping, setup, and what's unverified.

**Legacy source:** `PRINTBIL.PRG` isn't in the repo's history. `legacy/Workarea/` is gone from disk but is in commit
`77bb4b0`: `PRINTBIL.BAK`, `BILLEN.BAK`, `Petbill.exe` and a real receipt, `X.TXT`.

**Security finding, not acted on, needs the user:** that commit is on GitHub with real customer data, and an anonymous
request for `legacy/Workarea/CUSTOMER.DBF` at that commit returned HTTP 200. `bc0ce7a` only stopped tracking it.

**Built:** `services/receipt.ts`, `escpos.ts`, `billReceiptPdf.ts`, `printing.ts`; `repositories/printing.ts`;
`routes/printing.ts`; tables `print_settings`, `print_terminals`, `print_jobs`; `apps/print-bridge/`;
`lib/printing.ts`, `components/BillPrintActions.tsx`, `ReceiptPreview.tsx`, `app/(app)/printer-settings/page.tsx`;
Billing, Cashier and Attendant use the new actions, and the A5 invoice stays one click away.

**Time on bills:** `billTimestamp` stores UTC, so live bills show a time 5:30 behind. Fixing it there broke shift cash
totals, because `shifts.ts` compares `bill_date` with `datetime('now')`, and the test suite caught it. So `bill_date` is
unchanged, and a new `bills.local_time` (`STATION_TIME_ZONE`, default `Asia/Kolkata`) is what receipts print. Older
bills fall back to `bill_date`. Other screens and the A5 invoice still show UTC: seen, not changed. `todayDateOnly` is
also UTC, so "today" lags until 05:30 IST: seen, not changed.

**Also corrected:** `STATUS` is the bill type, which the migration notes and my importer comment had wrong.

**Decisions by the user, 2026-11-04:** the receipt prints the stored sub total rather than Petbill's formula, so its
figures add up. Imported bills keep their Petbill number in `legacy_bill_no`. Kerosene bills aren't migrated, as
PetroPro has no such type.

**Verified:** API tests 207/207 on two of three runs. The third failed only `pruneOldBackups`, the temp-folder race
already in `Project_Status.md`. Bridge tests 12/12. 38 deliberate breaks: 37 caught, three of them only after adding
tests. The other, removing the role check for QR-link tokens, changes nothing because `applyLiveSession` refuses them
too. Browser check 43/43 with the real bridge process and a fake LAN printer, four runs in a row on the final logic:
print, reprint, printer off and back, PetroPro unreachable, browser fallback, two terminals, 58 mm, phone width.

**Compared with Petbill:** the real April to June 2019 files in a scratch database. Legacy bill 3101, the saved form of
the sale in `X.TXT`, matches on every figure, customer, vehicle and cashier. Across all 3,606 bills, totals and tax match
the stored bill, the base differs on one bill by 0.01, and no line exceeds 48 characters. Imported bills get new numbers,
so legacy 3101 reprints as a different bill number.

**Not verified:** anything on a real printer. See section 5 of the doc.

**State:** with Session 27, committed as `3d5c2f8`, pushed and deployed on 2026-11-04, around 22:03 IST. The tests at
commit: API 208/208 twice, bridge 12/12, browser 43/43.
- **API:** release `v11`. Roll back to `v10`. The process was stopped for about 5 seconds (Fly logs: SIGINT at
  16:33:32Z, listening at 16:33:37Z).
- **Web:** `dpl_HqM6YUrkN9fXtpUsAzNNmDEHxCoQ`. Previous: `dpl_58cTFY9a8wYtWvhwbc3xpG46ggn7`.
- **Live checks, signed out only:** API health, the new routes answer 401, new screens send a visitor to sign in, the live
  code holds the new screens and print actions, the session route answers 401, no errors logged.
- **Not checked live, needs a real login:** printing, Legacy Import and Printer Settings on production data.
- **Backup:** none was taken for this deploy. The database changes only add tables and columns.
- **Still public at deploy time:** `legacy/Workarea/CUSTOMER.DBF` at `77bb4b0` still answered 200 without a login.

### 2026-11-05 — Session 29 (mileage reports: rate, amount and totals)

**Context:** the user reported that the mileage report shows no amount, and asked for it to be checked against the legacy
report. PRs #1, #2, #3 and #5 had landed on GitHub between sessions, including the customer mileage statement.

**Found:** Petbill's VWSMAGE and MCWS are sales reports with mileage alongside, built from the bill lines. PetroPro's were
built from `mileage_log`, so they had no rate or amount, and lost any bill without a reading. The vehicle report also
included cancelled bills and had no date range.

**Built:** `services/mileageReport.ts` backs `/reports/mileage`, `/reports/customers/:code/mileage` and
`/customer/reports/mileage`, reusing the statement engine's `foxRound`. `components/MileageTotals.tsx` shows the totals.
`/reports/mileage` now returns a report object rather than an array. Details are in `docs/MIGRATION_NOTES.md`.

**Verified:** API tests 231/231, bridge 12/12, 15 deliberate breaks all caught, browser 23/23 on staff screens. Real April to
June 2019 tables: 32 customers (amount, quantity, lines, bills) and 567 vehicles (amount, lines) match a direct calculation
from the raw DBFs.

**Not verified:** that `KMR` is the closing reading. It's inferred from `CR` appearing in the compiled symbol tables, and the
only two real `MAGE19` readings are 0. The user was asked to compare a real printout.

**State:** committed as `79641f5`, pushed and deployed on 2026-11-05. This also put PR #5 live.
- **API:** release `v15`. Roll back to `v14`.
- **Web:** `dpl_H8Ef6xMWzap3wMN9wd3hkoJTAHnb`. Previous: `dpl_Dcg7vrrJM44D8rcKk45x7yGczWCH`.
- **Live checks, signed out only:** API health, the routes answer 401, the live code holds the new report.

### 2026-11-05 — Session 30 (MAGE upload)

**Context:** imported bills showed amounts but no readings, and the user asked for `MAGE` import.

**Built:** `analyzeMileage` in `services/legacyImport.ts`, new `bills.legacy_status`, and mileage files going last in a batch on
the Legacy Import screen. Rules and real-data results are in `docs/MIGRATION_NOTES.md`.

**Changed behaviour:** `mileageRepo.lastForVehicle` now orders by the bill's date, not the row's id. Otherwise an imported old
reading would become a vehicle's starting point for its next live reading.

**Answered:** cancelled bills are removed from the monthly `BIL` files, so they can't import as sales.

**Verified:** API tests 243/243, 13 deliberate breaks all caught (one only after tightening a test), browser 13/13, real `MAGE18`.

**Limits:** a bill from the command-line importers has no legacy number, so `MAGE` can't reach it. Sales must be imported through
the screen first.

**State:** committed as `ca3fff4`, pushed and deployed on 2026-11-05.
- **API:** release `v16`. Roll back to `v15`.
- **Web:** `dpl_3w6QoptsJrUrzp7nsE8K1oikjGGB`. Previous: `dpl_H8Ef6xMWzap3wMN9wd3hkoJTAHnb`.
- **Live checks, signed out only:** API health, the import route answers 401, the live code holds the `MAGE` screen.

### 2026-11-05 — Session 31 (screen labels)

**Asked:** rename the customer section's `Order Entry login`.

**Done:** the heading on the customer screen now says `Customer Login`. It was `Customer Portal` for a while, and a later request
changed it. The old name remains only in a backend comment and a test name, which customers never see.

**Tried and removed:** `Customers` to `Customer Details` in the sidebar, page heading and Legacy Import messages, from the earlier
request "existing application replace it with Customer details screen". It conflicted with the later "only change this name"
brief. The user didn't choose when asked, so it was taken out, as recommended, and can be added back on request.

**Left alone:** the `Order Entry` heading on `/customer/orders`, because that page is where customers place orders.

### 2026-11-05 — Session 32 (Classic and Modern designs)

**Asked:** two selectable designs after login, with the layout unchanged and the choice saved in localStorage.

**Built:** `app/designs.css`, `lib/design.ts` and `components/DesignSwitcher.tsx`. The switcher is in the staff header and in the
header of both customer pages, and not on either login page. `<html data-design>` is set before first paint. No backend change.

**Rule for `designs.css`:** colours, radii, shadows and heading fonts only. Never a size, padding, margin, gap, border width or
position. Extra borders use `box-shadow`.

**Choices made:** no saved choice keeps the existing look. The first choice opens in light, because both palettes are drawn on
light backgrounds and customers have no light/dark button. Body text stays Inter in both designs; only Classic's headings change
font (Source Serif 4), because a different body font would change the width of every button and table cell.

**Verified on a production build with a throwaway database:** 15 staff screens and 2 customer screens at 1400px and 390px, compared
element by element against the existing look. Modern moved nothing. Classic's narrower headings changed 46 text-hugging boxes across
both widths, by at most 14.5px wide and 4px of shift, with no extra line wraps. Switcher 25/25. Contrast AA on 394 text items in each
of the four variants, on six screens. Customer print stays black on white.

**Limits:** the header gained one 36px button, so the items to its left moved 52px in every look, including the existing one. The
choice is per browser, so staff sharing a terminal share it. Once a design is chosen, the screen offers no way back to the old look.
Not tested on a real phone or with real data.

**Dev note:** force-stopping `next dev` corrupted `.next/dev` and every route returned 404 until that generated folder was deleted.

**Also decided:** no third "Original" option, as the brief asked for two designs. The user didn't choose when asked. Easy to add.

**State:** committed as `7ded81f` and `ce6b1fa`, pushed and deployed on 2026-11-05.
- **Web:** `dpl_EtT8zqnNeiZUqnG4vayx7cJhKNWK`. Previous: `dpl_3w6QoptsJrUrzp7nsE8K1oikjGGB`.
- **API:** not deployed, still `v16`. No backend code changed.
- **Live checks, signed out only:** the live code holds both designs, `Customer Login` and the real API address; a saved design applies on the login pages; neither login page shows the switcher; API health is fine and `/customers` answers 401. The signed-in switcher was tested locally, not on the live site.

### 2026-11-06 — Session 33 (login background)

**Built:** the user's petrol station photo, `public/login-background.png` (740 x 494, unchanged), behind the staff login form only.
First it filled the screen with `cover`; the user then asked for it to fit each screen, so it is now `contain`, with a blurred `cover`
copy filling the leftover space and a 45% dark overlay. All three layers are absolute, so the form keeps its exact position and size.

**Verified:** in a browser at five screen sizes, locally; the form and its fields didn't move and the photo kept its proportions. Live,
signed out: the served image is byte-identical to the upload, the staff login renders with it, and the customer login is unchanged.

**Open:** on an upright phone the whole photo is a 260px band mostly behind the form. Offered: fill the screen on phones only. The image
is small, so it's soft on large monitors. The user was asked to confirm the photo's licence.

**State:** committed as `2f074b6`, pushed and deployed on 2026-11-06.
- **Web:** `dpl_BVNNfiVE89LimmQToWNPXQZGEcfJ`. Previous: `dpl_EtT8zqnNeiZUqnG4vayx7cJhKNWK`.
- **API:** not deployed, still `v16`.

### 2026-11-06 — Session 34 (Classic field colours)

**Built:** in `app/designs.css`, Classic only (light and dark): fields `#E0F2FE` with `#071B3A` borders and `#263238` text,
placeholder `#5F6B7A`, and a navy focus ring (`inset` 1px line plus a 3px glow). The item picker list (`[role="listbox"]`) matches.
Checkboxes, radios, file pickers and buttons are excluded. Colours and box-shadow only.

**Changed from the request:** the user's spec said a soft grey placeholder; `#64748B` was 4.1:1, so `#5F6B7A` (4.7:1) was used. The
inset line was added because a navy glow alone is invisible on Classic dark's navy cards.

**Verified locally:** 68 fields on 15 staff screens plus both login and both customer pages, Classic light and dark; layout identical
with the rules switched off in the page; Modern unaffected; focus moves nothing. Live, signed out: login pages' fields correct in
Classic, unchanged in Modern, positions unchanged.

**State:** committed as `53f8bba`, pushed and deployed on 2026-11-06.
- **Web:** `dpl_Hi5TNXis44Nhixqqvj7toCihN8me`. Previous: `dpl_BVNNfiVE89LimmQToWNPXQZGEcfJ`.
- **API:** not deployed, still `v16`.

### 2026-11-06 — Session 35 (Classic navy sidebar and sky-blue work area)

**Asked:** navy sidebar with a golden-yellow active item, sky-blue work area, white cards, white header with navy text and borders.
The user chose Classic Design only, and sent a screenshot of the current Classic light dashboard as the layout reference.

**Built, in `app/designs.css` plus `data-app-shell` (app layout) and `data-app-header` (Header):**
- **Sidebar, Classic light and dark:** `#071B3A` with a navy gradient, white/light-grey text, `#12305A` hover, `#E0B52F` glossy gold
  active item and logo tile.
- **Classic light only:** work area `#BAE6FD` to `#38BDF8` on the app shell and on `body` (customer pages); `--pp-border` soft navy
  (`rgb(7 27 58 / 0.24)`); navy card shadows; header white with navy text, icons, separator and bottom border.
- **Readability:** in Classic light, muted text is `#2C4468` and status colours are a shade darker (`#14532D`, `#92400E`, `#991B1B`),
  so text sitting straight on `#38BDF8` stays readable.

**Verified locally:** before/after measurement of every element on 15 staff and 2 customer screens in all five looks. No element
moved because of the theme; Dashboard and Audit Logs moved identically in every look, from extra sign-in rows. Default and Modern
colours unchanged. Readability check on 624 text items, Classic light and dark: all pass. Live, signed out: customer login shows the
gradient in Classic light only, the form is unmoved, and the live CSS holds the new rules.

**Deploy note:** the first `vercel deploy` failed with "fetch failed" before building; a retry worked.

**State:** committed as `1a5d7d1`, pushed and deployed on 2026-11-06.
- **Web:** `dpl_9GUYSaLk916hNJkpJdt3NLWU53JZ`. Previous: `dpl_Hi5TNXis44Nhixqqvj7toCihN8me`.
- **API:** not deployed, still `v16`.
