# Project_Status.md

Snapshot of where PetroPro stands. Update this at the end of every session — it should always reflect
current reality, not a historical log (see `AI_Handoff.md` for the dated log).

## Phase status

Legend: ✅ done · 🚧 in progress · ⬜ planned (full detail in [docs/ROADMAP.md](docs/ROADMAP.md))

| Phase | Status |
| --- | --- |
| 0 — Reverse engineering | ✅ (module map now written — see Session 8) |
| 1 — Foundation & core domain | ✅ |
| 2 — Billing & inventory | ✅ |
| 3 — Reports & tax | ✅ |
| 4 — Offline sync & operations | ✅ |
| 5 — Hardening | ✅ (scope adjusted — see `docs/ROADMAP.md`) |

All five roadmap phases are complete, plus six post-roadmap sessions (8, 9, 10, 11, 12, 13). That
does not mean there's nothing left — read "Known gaps" below and `Todo.md` before assuming a feature
is finished just because its phase is checked off.

**The dev database currently on disk (`apps/api/data/petropro.db`) has real legacy data loaded**:
full master data (`npm run import:legacy`) plus 3 real months of transactions, 2019-04-01 through
2019-06-15/16 (`npm run import:demo-transactions`) — 3,606 bills, 4,047 bill lines, 5,313
stock-day-book rows, 114 purchases, 2 mileage entries. This was loaded for a client demo (Session
11), not left over from testing — don't reset it to a bare seed without checking whether that demo
still needs it. See `docs/MIGRATION_NOTES.md`'s "Demo transaction window" section for exactly what
this is and its known limitations (no cancelled bills, no receipts in this window since the real
data has none, `customers.due_amount` doesn't reconcile with the 3-month ledger slice).

## What exists on disk right now

- `docs/DATA_DICTIONARY.md`, `docs/ER_DIAGRAM.md`, `docs/ROADMAP.md`, `docs/MIGRATION_NOTES.md`,
  `docs/MODULES.md` (legacy menu → modern feature map, researched from
  `legacy/Workarea/MAINMENU.PRG` directly rather than guessed)
- `legacy/Workarea/` — original FoxPro sources (read-only reference)
- `legacy/dbf_schema.py` — DBF structure/row-count dumper (Python, header-only)
- Root `package.json` (npm workspaces), `.github/workflows/ci.yml`, `docker-compose.yml`,
  `.dockerignore`
- `CLAUDE.md`, `AI_Handoff.md`, `Project_Status.md`, `Todo.md` — AI-agent context/process docs
- `daily-prompts/` — informational chat-prompt log, not part of the application
- `PetBro.zip` — original legacy application archive (source for `legacy/Workarea/`)
- **`packages/shared-types`** — new this session. Wire-format types (`Item`, `Customer`, `Bill`,
  `Role`, etc.) that `apps/web/lib/api.ts` now imports instead of hand-duplicating; built via `tsc`
  to `dist/` (root `postinstall` builds it automatically). All exports are type-only, so it doesn't
  add a runtime dependency to either app's compiled output — only a build/typecheck-time one.
- **`apps/api`** — Fastify + TypeScript REST backend, SQLite via `node:sqlite`. Covers Phases 1–5 in
  full plus Session 9's user management, Session 10's rate-change delete/retract
  (`DELETE /rate-changes/:id`, blocked once applied), receipt PDF (`GET /receipts/:recNo/pdf`,
  mirrors the existing invoice PDF), and a `settings` table + `GET`/`PUT /settings` for the legacy
  `SETTINGS.DBF`-style operational flags (admin-only to change, manager can read). Session 12:
  `stock_daybook.closed` is now actually enforced (see below). Session 13: `company_profile` renamed
  to **`tenants`** (`GET`/`PUT /tenant`, `repositories/tenants.ts`) — one row per deployment (one
  SQLite database per customer, not a shared multi-tenant schema; see "Known gaps"), seeded with the
  real Srinivasa Agencies identity via a new `importTenant()` step in `dbf/import.ts`
  (`HEADINGS.DBF` + `SETTINGS.DBF`'s `GSTNO`). Invoice/receipt PDFs now also print the tenant's
  tagline. Sessions since 13 without handoff detail added mileage tracking, a customer order portal,
  richer reporting, and HSN codes on the item master (see "Known gaps" — doc trail lost for these).
  Session 14: `routes/googleAuth.ts` (Google SSO for staff, additive to password login, matches by
  a new `users.email` column), `bills.client_ref` (offline-queue idempotency, same pattern as
  `pending_transactions.client_ref`), `services/backup.ts`'s daily auto-backup scheduler +
  `GET /backup/:filename/download`, and `reportsRepo.salesByHsn()` + group-nested stock/purchase
  reports. **73 tests total** (was 46 as of Session 13; the jump includes the undocumented
  intermediate sessions' tests, not all added by Session 14).
- **`apps/web`** — Next.js (App Router, Turbopack) + TypeScript + Tailwind PWA, **21 routes** (was 18
  as of Session 13; `/login/callback` is new in Session 14, the rest from undocumented intermediate
  sessions). Session 13: `NavBar` rebuilt as legacy-`MAINMENU.PRG`-style dropdown groups
  (Maintenance/Bill/Reports/Search/Utilities, colored per group) showing the live tenant name instead
  of a hardcoded "PetroPro"; new shared `components/Card.tsx` (colored-left-border bordered panel,
  color matched to each page's NavBar group) applied across all 14 authenticated pages, replacing the
  ad hoc `border-zinc-200` wrappers every page used to hand-roll; `/billing` reworked into a
  master-detail layout (payment-type header + a real line-items table with computed rate/amount) with
  the customer-code field and a due/credit-limit panel shown only for Credit, hidden for Cash/Card.
  Session 14: `/login/callback` (lands here after Google SSO, hands off to the same role-based
  routing password login uses) and `components/DesktopTitleBar.tsx` (only renders inside the
  `scripts/desktop/start.mjs` kiosk window — a slim bar with a Close button, invisible in the
  ordinary browser/PWA case).

- **`apps/api/src/dbf/importTransactions.ts`** — Session 11 (`npm run import:demo-transactions`
  from `apps/api`). Imports a fixed real 3-month window (2019-04 through mid-2019-06, the actual
  most recent transactional data in `legacy/Workarea/`) of bills/bill_lines/stock_daybook/purchases/
  mileage_log for demo purposes. See `docs/MIGRATION_NOTES.md`. Deliberately scoped — not the full
  historical migration below, and not what `import:legacy` does.
- **`stock_daybook.closed` hard enforcement** — Session 12. `stockRepo.applySale`/`applyReceipt`/
  `reverseSale` now throw if the target date's row is already closed; `closeDay(date)` rolls forward
  a (zero-delta) row for every item first, so a date closes correctly even if nothing has
  transacted on it yet. `services/billing.ts` and `services/purchasing.ts` were reordered so the
  stock check runs *before* the bill/purchase row is committed — otherwise a closed-day rejection
  would leave an orphaned bill/purchase with no matching stock posting. 7 new tests
  (`repositories/stock.test.ts`, plus 2 each in `billing.test.ts`/new `purchasing.test.ts`).

## What does NOT exist yet

- **Full** historical **transactional** data migration (decades of monthly bill/stock/purchase/
  receipt tables across every fiscal year) — only current master data (`import:legacy`) plus one
  fixed 3-month demo window (`import:demo-transactions`, new this session) exist. See
  `docs/MIGRATION_NOTES.md`. The full version remains unattempted — flagged as materially larger
  than a single scoped window.
- An output validation harness vs FoxPro reports — no reference FoxPro output exists in this repo
  to validate against; not fabricated. Still blocked.
- Browser-based E2E tests (Playwright/Cypress) — no browser automation tool has been available in
  any session so far, this one included. Session 13's NavBar/billing UI rework was verified via
  `tsc`/`eslint`/production build (all clean) plus HTTP-level checks of the data it renders
  (`GET /tenant`, credit-limit rejection, a downloaded+read invoice PDF confirming the new
  letterhead) — the dropdown menu and master-detail layout's actual rendering were not visually
  confirmed in a browser.
- Real-world verification of the Docker packaging and CI workflow — both written in Session 7, and
  the Dockerfiles were updated in Session 10 for the `packages/shared-types` build step, but neither
  has actually been run (no Docker in this dev environment). The repo is on git now (Session 14
  found it already initialized, on branch `master`) but hasn't been pushed anywhere a real Actions
  run could happen — still blocked on both fronts.
- **Google SSO and the desktop kiosk launcher (Session 14) are unverified beyond a clean
  typecheck/lint/build** — no real Google OAuth credentials and no Chromium browser have been
  available in this environment to exercise either end-to-end. See `AI_Handoff.md` Session 14.
- **This file, `AI_Handoff.md`, and `Todo.md` fell out of sync with the repo for several sessions**
  — `git log` shows commits (`6eb6f57`, `4b1e977`, `f17bd34`, `91630be`: mileage tracking, customer
  order portal, richer reporting, HSN codes, build-context exclusions) with no matching handoff
  entries. That history isn't reconstructable from these docs; Session 14 restarted the discipline
  but didn't attempt to backfill what those sessions actually did or why.
- Any behavior actually gated by the new operational-settings flags (e.g. `FLEETCARDENTRY=NO`
  doesn't hide fleet-card fields anywhere) — the gap asked for a settings screen, not new gating
  logic, and `SETTINGS.PRG` doesn't survive in `legacy/Workarea/` to confirm what the legacy gating
  behavior even was.

## Known gaps / open questions

- **`tenants` is deliberately one row per deployment, not a shared multi-tenant schema.** Session 13
  explicitly chose "one SQLite database per customer" over "tenant_id on every table" when the user
  said they plan to sell this to multiple customers — SQLite's single-writer-per-file model and the
  compliance risk of a missed `WHERE tenant_id=?` clause made per-deployment isolation the safer,
  cheaper choice. If that decision is ever revisited: it touches all 19 repositories' queries, all
  ~72 endpoints, and the JWT payload (`AuthTokenPayload` in `plugins/auth.ts` has no tenant claim
  today) — not a small follow-up.
- **`BILL_NO` alone is not a unique key within a single legacy monthly bill table** — confirmed
  against real data (`APRBIL19.DBF`'s `BILL_NO=1` covers two unrelated transactions at different
  times). Any future code touching the raw bill DBFs must group by `(BILL_NO, BTIME)`, not
  `BILL_NO` alone — see `docs/MIGRATION_NOTES.md`'s "Demo transaction window" section for how this
  was found (grouping by `BILL_NO` alone silently merged unrelated transactions into single
  million-rupee bills before it was caught).
- `packages/shared-types` has no build-watch story — editing its `src/` requires re-running its
  build (or reinstalling, which triggers the root `postinstall`) before `apps/api`/`apps/web` will
  see the change, since both consume its compiled `dist/`, not the source directly.
- `services/rateChanges.ts`'s `applyDueRateChanges()` returns the pre-mutation snapshot of the rows
  it applies (fetched before the loop that marks them applied), so the response body shows
  `applied: 0` for changes that are, by response time, actually `applied: 1` in the database —
  cosmetic only (confirmed a follow-up `GET /rate-changes` shows the correct state), pre-existing,
  not introduced this session.
- `amountInWords()`'s "Rupees ... Only" wrapper phrasing is a standard convention, not verified
  against a legacy invoice printout — only the digit-grouping algorithm is a byte-for-byte port of
  `MONEY.PRG` (now test-covered, `services/money.test.ts`).
- `node:sqlite` requires Node >=22.5; stated correctly in both `package.json`s and the Dockerfiles
  (`node:22-alpine`).
- Receipts' `service_charge` field is stored but not applied to `due_amount`.
- `opening_balances` overwrites `customers.due_amount` outright (not additive) — a one-time
  onboarding/migration baseline; calling it twice for the same customer stomps accrued activity.
- Floating-point due_amount/report noise (cosmetic SQLite REAL rounding) — not corrected with a
  fixed-point/cents representation.
- **Date-range queries must compare against `date(column)`, not the raw column** (bitten twice —
  Phase 3's reports, Phase 4's shifts). Any new date-range query must follow the established
  pattern in `repositories/reports.ts`/`purchases.ts`/`services/ledger.ts`/`repositories/shifts.ts`.
- **Any repository `create`/`update` taking optional fields needs an explicit `?? 0`/`?? null`
  fallback for every optional field** (`node:sqlite` throws on bound `undefined`) — bit
  `customersRepo` in Session 5; the regression is now pinned by
  `repositories/customers.test.ts`.
- **Destructuring `db` out of a dynamic `import()` captures a stale snapshot, not a live binding**
  — discovered writing `backup.test.ts` this session. `const { db } = await import(...)` copies
  the value at that instant; it does not track `db/client.ts`'s later reassignment inside
  `openDb()`. Only a real static `import { db } from "..."` (what every repository already uses)
  or repeated property access on the retained namespace object (`const mod = await import(...);
  mod.db`) stays live. Doesn't affect production code (nothing there uses dynamic import for this
  module) — only matters if a future test or script needs to observe `db` across a close/reopen.
- Invoice PDF layout is deliberately minimal (manual x/y positioning, no table library, A5 page).
- Reports/shifts-list/audit-logs/backup are gated admin/manager (or admin-only for backup); no
  separate "reports viewer" or "auditor" role exists.
- `apps/web`'s report viewer (`/reports`) uses one shared page with a report-type switch rather
  than per-report routes — no shareable/bookmarkable report+filter URL.
- The offline queue's "come back online, auto-sync" path (Phase 4) has still only been verified by
  code review + testing the server-side dedup it depends on — no browser automation tool has been
  available to actually drive it end-to-end in a real browser.
- Dev ports: API defaults to 4000, web to 3000 (may collide with other local projects — use
  `next dev -p <port>` if so).
- New user accounts and password resets get an auto-generated temporary password returned **once**
  in the API response (never stored in plaintext, never emailed/SMS'd — there's no notification
  channel to do that with). Whoever creates the account or resets the password has to relay the
  temporary password out-of-band. An admin cannot deactivate their own account (blocked with 400)
  — there's no other in-app recovery path if the last admin got locked out.

## Current blockers

None.
