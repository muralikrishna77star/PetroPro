# Todo.md

All five roadmap phases (`docs/ROADMAP.md`) are complete, plus four post-roadmap sessions. This
file tracks the genuine remaining gaps — read it before assuming there's nothing left to do.

## Phases 1–5 ✅ complete

See `AI_Handoff.md` Sessions 1–7 for full detail on each phase.

## Session 8 — gap closing (post-roadmap)

Closed two of three gaps flagged at the end of Session 7:

- [x] **`docs/MODULES.md`** — legacy menu → modern feature map, researched from the actual
      `MAINMENU.PRG` menu source (no compiled `.MNX`/`.MNT` files exist). Found that most of what
      the legacy menu dispatches to no longer exists as source anywhere in this repo; tagged every
      menu item with what actually survives. Cross-referencing surfaced concrete gaps addressed
      below and in Session 9.
- [x] **Admin CRUD UI for groups/items** (`/catalog` page).
- [ ] **`packages/*` shared types package** — still not done; deprioritized as a drift-risk
      reduction, not a missing capability.

## Session 9 — user management (post-roadmap)

The `docs/MODULES.md` cross-reference from Session 8 surfaced that PetroPro had **no way to create,
edit, deactivate, or reset the password of a user at runtime** — every account came from
`db/seed.ts` or the DBF importer. Closed:

- [x] **Schema**: `users.active` column (default 1).
- [x] **`usersRepo`**: `create()` now returns the created user (was `void`) and never includes
      `password_hash`; added `update()`, `setActive()`, `setPasswordHash()`.
- [x] **Login enforces `active`** — a correct password for a deactivated account is rejected with a
      clear message, verified as a distinct check (not just piggybacking on the wrong-password
      path).
- [x] **`routes/users.ts`** (admin-only): list, create (auto-generates a temporary password unless
      one is supplied, returned once in the response — never stored in plaintext), update
      name/role, deactivate, reactivate, reset-password. Rejects a duplicate `user_id` with 409
      rather than letting a raw SQLite constraint error bubble up as a 500. Refuses to let an admin
      deactivate their own account (would lock them out with no in-app recovery). All five mutating
      actions are audit-logged.
- [x] **4 new regression tests** (`repositories/users.test.ts`) — active defaults to 1,
      `password_hash` never leaks through `create`/`update`/`list`, `setActive`/`setPasswordHash`
      work. 33 tests total now (was 29).
- [x] **`/users` admin page** — list with role/status/created-at, create form, inline edit
      (name/role), deactivate/reactivate, reset-password (shows the new temporary password once,
      dismissible). Gated to the `admin` role specifically (not `manager`) to match the backend
      exactly.

Verified end-to-end 2026-07-13 (Session 9): full test suite (33/33) + `tsc`/`eslint`/production
build clean (18 web routes, up from 17). Hit every new endpoint over HTTP with the frontend's exact
payload shapes: create → login with the temp password → duplicate rejected (409) → deactivate →
login correctly rejected even with the *right* password → self-deactivation blocked (400) →
reactivate → reset-password → update role/name → non-admin blocked (403) but can still authenticate
normally. Confirmed CORS for the new routes.

## Session 10 — gap closing (post-roadmap)

The user asked to "proceed with filling the gaps," naming the list below explicitly (plural), read
as authorization to work through several in one session rather than picking exactly one. Closed the
four that were actually actionable in this dev environment:

- [x] **Rate-change delete/retract** — `DELETE /rate-changes/:id`, blocked (400) once the change
      has already been applied, 404 if it doesn't exist, audit-logged. "Retract" button on pending
      rows in `/rate-changes`.
- [x] **Receipt print/PDF output** — `GET /receipts/:recNo/pdf`, mirrors the existing invoice PDF
      pattern. Print links added to the customer ledger table and right after recording a receipt.
- [x] **Settings screen for legacy operational flags** — new `settings` key/value table seeded with
      the real `SETTINGS.DBF` defaults (dumped from `legacy/Workarea/SETTINGS.DBF` directly, not
      guessed): `KEROSENE`, `FLEETCARDENTRY`, `PRINTTESTMODE`, `PRINTSPECIALCHARACTERS`,
      `BILLENTRY`, `GSTNAMEADD`. `GET`/`PUT /settings`, admin-only to change. New "Operational
      Settings" section on the existing `/settings` page. Storage/display only — none of these
      flags gate any actual behavior elsewhere in the app yet (see `Project_Status.md`).
- [x] **`packages/shared-types` workspace package** — the wire-format types `apps/web/lib/api.ts`
      used to hand-declare, now imported from one place; also unified the two independently-declared
      `Role` type unions (`apps/web/lib/auth.ts` and `apps/api/src/repositories/users.ts`). Type-only
      exports, so no runtime dependency added to either app's build output — Dockerfiles updated for
      the build-time-only step, still unverified (no Docker here).

4 new tests (2 rate-changes, 2 settings) — 37 total (was 33). Full HTTP verification against a
running server: see `AI_Handoff.md` Session 10 for the complete pass (role gating, audit logging,
PDF byte-level confirmation, error paths).

## Session 11 — demo transaction data (post-roadmap)

The user asked to load real data for a client demo, explicitly scoped down from a full historical
migration: "do not migrate all the data, just keep last 3 months of data." Also asked to keep the
real historical dates rather than shift them to look current.

- [x] **`apps/api/src/dbf/importTransactions.ts`** (new) + `npm run import:demo-transactions`.
      Found the actual most recent 3 consecutive months of real transactional data in
      `legacy/Workarea/` by reading `BILL_DATE`/`SDATE`/`PUR_DATE` values directly (filename year
      suffixes aren't reliably chronological) — 2019-04-01 through 2019-06-15/16. Imported bills +
      bill_lines (3,606 / 4,047), stock_daybook (5,313), purchases (114), mileage_log (2). Run-once
      idempotency guard (skips entirely if bills already exist in that date window) rather than
      per-row natural keys, appropriate for a fixed one-shot window.
- [x] **Found and fixed a real bug while verifying**: grouping bill lines by `BILL_NO` alone
      silently merged unrelated transactions that happen to share a bill number within the same
      monthly file (confirmed: `APRBIL19.DBF`'s `BILL_NO=1` is two different transactions at two
      different times) — produced bogus million-rupee "bills." Fixed by grouping on
      `(BILL_NO, BTIME)` instead, verified against the raw source rows before/after. See
      `docs/MIGRATION_NOTES.md`.
- [x] Deliberately did **not** import `BILLCNCS.DBF` (cancelled bills — lacks the rate/tax fields
      needed to reconstruct `bill_lines`) or receipts (the real dataset has zero receipt rows in
      this window). Also did not touch `customers.due_amount` for the newly-imported credit bills —
      it's a live master-data snapshot from years later; stacking 3 months of 2019 activity onto it
      would double-count. See `docs/MIGRATION_NOTES.md` for the full reasoning and a heads-up about
      an unusual real-data pattern (large no-vehicle/no-customer bills) worth knowing before
      presenting the demo.

Verified: full HTTP pass against a running server (bill register, item/GST sales reports, stock
report, purchase report, customer ledger for a real credit customer) all return correct data for
the window; full test suite still 37/37; typecheck/lint/build clean. **The dev database currently
on disk has this data loaded** — see `Project_Status.md`.

## Session 12 — stock_daybook.closed enforcement (post-roadmap)

The user asked to close one of the accumulated "Known gaps" from `Project_Status.md`; picked
`stock_daybook.closed` being advisory-only (closing a day's stock book didn't actually block
further writes to that date).

- [x] **`repositories/stock.ts`**: `applySale`/`applyReceipt`/`reverseSale` now throw
      (`Stock day <date> is closed to further postings`) if the target date is already closed.
      `closeDay(date)` rolls forward a zero-delta row for every item in the item master before
      flipping `closed = 1`, so a date closes correctly even when nothing has transacted on it
      yet — `isDateClosed` is a date-level check (any closed row for that `sdate`), and without
      this the UPDATE would affect zero rows and silently fail to close anything.
- [x] **Fixed a real ordering bug found while wiring this up**: `services/billing.ts`
      (`settlePendingTransaction`, `createWalkInBill`) and `services/purchasing.ts`
      (`recordPurchase`) all applied the stock-day-book write *after* committing the bill/purchase
      row. A closed-day rejection thrown at that point would leave an orphaned bill or purchase
      with no matching stock posting. Reordered so the stock check/write happens first in all
      three; `cancelBill` was already correctly ordered (stock reversal before `billsRepo.cancel`).
- [x] **7 new tests** — `repositories/stock.test.ts` (new, 3 tests: closed date blocks all three
      write paths, closing a date with zero prior rows still works, an open date is unaffected),
      2 new tests in `billing.test.ts` (closed-day rejection creates no bill; cancelling a bill
      whose sale date is now closed is rejected), 2 in `purchasing.test.ts` (new file: normal
      receipt posting, closed-day rejection records no purchase). 44 tests total (was 37).

Verified: full test suite (44/44), `tsc` build (shared-types + api + web) and `next build` (18
routes, unchanged) both clean, `eslint` clean. No HTTP-level pass this session (no running server
in this environment) — the two routes that surface this (`POST /bills`, `POST /bills/settle`,
`POST /bills/:billNo/cancel`, `POST /purchases`) already funnel thrown `Error`s into a `400` with
`.message` via their existing `try/catch`, same pattern as every other service-layer validation
error in these routes, so no route-level change was needed.

## Session 13 — tenant identity, legacy-menu nav, colorful UI, billing master-detail (post-roadmap)

The user asked for four things together: restyle the app (borders + color), make it "multi-tenant"
and set up the first tenant from real data in the legacy DBFs, rebuild the nav to mirror
`MAINMENU.PRG`, and rework billing into a master-detail layout with Cash/Credit-conditional fields.
Entered plan mode given the size (touches ~20 files across both apps) and the multi-tenant ask being
a genuine architectural fork; the user was asked to pick between a shared multi-tenant schema and a
one-database-per-deployment model, and — after being walked through the SQLite single-writer-file
tradeoff — chose the latter (see `Project_Status.md`'s "Known gaps" for the full reasoning and what
it would take to revisit).

- [x] **Tenant model**: `company_profile` (singleton, `CHECK(id=1)`) renamed to `tenants`, +
      `tagline` column. `repositories/companyProfile.ts` → `tenants.ts`, `routes/companyProfile.ts`
      → `tenant.ts` (`GET`/`PUT /tenant`, was `/company-profile`), `CompanyProfile` type →
      `Tenant` in `packages/shared-types`. `invoicePdf.ts`/`receiptPdf.ts` both switched to
      `tenantsRepo` and the invoice now prints the tagline in italics.
- [x] **Real Srinivasa Agencies data pulled from the DBFs**, not fabricated — found by dumping raw
      row bytes from `HEADINGS.DBF` (name/address/tagline) and `SETTINGS.DBF`'s `GSTNO` key
      (cross-checked against `SA.PRG`'s hardcoded letterhead, confirming this is the same real
      dealer). New `dbf/import.ts` step `importTenant()` (always overwrites — a singleton config
      record, not an append-only import) wired into `runImport()`. Re-ran `npm run import:legacy`
      against the live dev DB; `GET /tenant` now returns the real record (see `docs/MODULES.md`'s
      "Multi-dealer white-label deployment" note, updated to reference this).
- [x] **`NavBar` rebuilt as dropdown groups mirroring `MAINMENU.PRG`'s pads/popups**
      (Maintenance/Bill/Reports/Search/Utilities, using the existing `docs/MODULES.md` mapping —
      only pages that already exist got grouped, no new pages built), each group color-coded;
      header now shows the live tenant name via `GET /tenant` instead of a hardcoded "PetroPro".
- [x] **New `components/Card.tsx`** (bordered panel, colored left-border accent matching each
      page's NavBar group) applied across all 14 authenticated pages, replacing the ad hoc
      `border-zinc-200` wrappers every page previously hand-rolled.
- [x] **`/billing` reworked into master-detail**: payment-type segmented control (Cash/Credit/Card)
      in a header section; Customer Code + a due-amount/credit-limit info panel (mirroring
      `BILLEN.BAK`'s on-screen "Credit Limit: Rs. X") shown only when Credit is selected, hidden for
      Cash/Card; line items moved from a bullet list into a real table with computed Rate/Amount
      columns and a grand-total footer.
- [x] **2 new tests** (`repositories/tenants.test.ts`) — 46 total (was 44).

Verified: full test suite (46/46), `tsc` build (shared-types + api + web) and `next build` (18
routes, unchanged) both clean, `eslint` clean (one `react-hooks/set-state-in-effect` finding in the
new billing credit-lookup effect, fixed by consolidating to a single guarded `setState` call rather
than disabling the rule). HTTP-level pass against a running server: `GET /tenant` returns the real
data; downloaded and read an actual invoice PDF back to confirm the new letterhead + tagline render
correctly; confirmed the credit-limit-exceeded rejection path still works (tried a real over-limit
customer from the imported data, got the expected 400) and that `GET /customers/:code` returns the
due/credit-limit fields the new UI panel needs. **Could not visually verify the NavBar dropdowns or
billing master-detail layout in an actual browser** — no Playwright/Puppeteer/chromium-cli available
in this environment (same gap as every prior session); relied on clean typecheck/lint/build plus the
HTTP-level checks above instead.

## Real remaining gaps (not phase-blocking, carried forward)

- **Full** historical transactional migration (every fiscal year, not just the one 3-month demo
  window above) — materially larger effort, not attempted.
- An output validation harness vs FoxPro reports — no reference FoxPro output exists in this repo
  to validate against; not fabricated.
- Browser-based E2E tests (Playwright/Cypress) — no browser automation tool has been available in
  any session so far.
- Real-world verification of the Docker packaging and CI workflow (Dockerfiles updated Session 10
  for the shared-types build step, but neither has actually been run — no Docker in this dev
  environment; repo isn't a git repository yet).
- See `Project_Status.md`'s "Known gaps" for smaller, accumulated items (date-range query pattern,
  floating-point rounding, `opening_balances` overwrite semantics, the destructured-dynamic-import
  gotcha, the `applyDueRateChanges()` stale-response-snapshot quirk, the `BILL_NO`-isn't-unique
  finding from this session, etc.) — still true, still worth reading before touching related code.
