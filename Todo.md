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

## Session 14 — doc-gap note + Google SSO, desktop launcher, offline bill idempotency, auto-backup, HSN/group reports

Picked up a large already-written but uncommitted/unverified working tree (see `AI_Handoff.md`
Session 14 for full detail on both what was built and the doc-tracking gap since Session 13 — commits
`6eb6f57`/`4b1e977`/`f17bd34`/`91630be` landed with no matching handoff entry).

- [x] **Google SSO for staff** — `GET /auth/google` + `/auth/google/callback`, matches an existing
      active user by `users.email` (new column), no auto-provisioning. Gated off by default
      (`GOOGLE_CLIENT_ID`/`SECRET` unset → 501; `NEXT_PUBLIC_GOOGLE_SSO_ENABLED` unset → no button).
- [x] **Desktop kiosk launcher** — `npm run desktop` (script existed, wasn't wired into
      `package.json` until this session) starts the built API+web servers and opens a chromeless
      Chromium kiosk window; `DesktopTitleBar` gives it a Close button via a localhost control server.
- [x] **Offline bill-queue idempotency** — `bills.client_ref`, same pattern as the existing
      `pending_transactions.client_ref`; web's IndexedDB offline queue gained a second store for
      full queued bills (not just pending fuel entries).
- [x] **Automatic daily backups** — `AUTOBACKUP` setting, checked on startup + every 24h, keeps the
      newest 14; new `GET /backup/:filename/download` to get a copy off the server.
- [x] **HSN-wise GST report** (`salesByHsn`) + group-nesting added to the stock and purchase reports
      (`stockSummary`, new `purchasesByGroupItems`), matching the existing group-nested sales report.
- [x] **Users page: email field** — what an admin sets to enable Google SSO for a staff account.
- [x] Fixed one lint finding (stale `eslint-disable` in `billing/page.tsx`) and wired the missing
      `"desktop"` root npm script — the only two loose ends found during verification.

Verified: full test suite (73/73), `typecheck`/`lint`/`build` all clean (21 web routes). **Not
verified**: the real Google OAuth round trip (no credentials configured here) and the desktop
launcher's actual browser-opening behavior (no Chromium + no built output exercised this session) —
both need a non-headless environment with real credentials/a browser installed.

**Update, same day:** the offline-billing half *was* subsequently verified for real (see Session 15
below) — installed `playwright-core` in a scratch dir and drove it against the system's Edge browser,
the first time any session in this project has had real browser automation available. Struck through
here in spirit; full detail in Session 15 rather than rewritten in place.

## Session 15 — real browser verification (offline sync) + AutoComplete Combobox

**Context:** continuing directly from Session 14. Asked the user what to pick up next; they chose
verifying the offline billing sync for real over starting the (untracked, unstarted) WhatsApp invoice
module or other `Todo.md` gaps. Mid-verification, the user separately asked for the shared
`Combobox` component (item/customer/vehicle/pump pickers, native `<input list>`/`<datalist>` today)
to become a real filtering autocomplete dropdown, applied everywhere it's used — sequenced to land
after the verification in progress.

- [x] **First real browser automation available in this project's history.** No `chromium-cli` in
      this environment, but the machine has Edge installed
      (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`) — installed `playwright-core`
      (no bundled-browser download) in a scratch directory and launched it with `executablePath`
      pointed at the system Edge. Every prior session's "not verified — no browser automation tool
      available" note for offline/UI behavior was a real, environment-imposed limit, not something
      skipped by choice; this unblocks it going forward if the same tool is available.
- [x] **Offline billing sync, driven end-to-end for real**: logged in as `admin`, turned on
      `OFFLINEMODE` via the API, opened `/billing`, added a line, set the browser context offline
      (`context.setOffline(true)` — real `navigator.onLine` + real `online`/`offline` events, not
      just blocked requests), submitted — got the "Offline — bill queued" notice, and confirmed the
      bill actually landed in IndexedDB's `queued-bills` store (read directly via
      `indexedDB.open()` in-page). Went back online; the page's own `online` listener fired
      `flushBillQueue()` automatically with no manual action — IndexedDB emptied and the bill
      appeared in the Recent Bills panel. Separately confirmed the idempotency guarantee this
      depends on on the API side directly: posted the same `clientRef` to `POST /bills` twice,
      got back the identical `bill_no` both times. Cleaned up afterward — cancelled both test bills
      and reverted `OFFLINEMODE` to `NO` — so the real demo dataset (Session 11) wasn't left dirty.
- [x] **`Combobox` rewritten as a real autocomplete** (`apps/web/components/ui/Combobox.tsx`) —
      same external prop shape (`options`/`value`/`onChange`/`className`/native input props) so
      none of its 9 existing call sites needed to change. Filters `options` by substring match on
      label or value as you type (capped at 50 rendered rows), dropdown opens on focus, full
      keyboard nav (arrow keys to highlight, Enter to select, Escape to close), click-to-select via
      `onMouseDown` + `preventDefault` (so the dropdown doesn't close from the input's `onBlur`
      before the click registers), closes on blur/outside click. `value` still updates on every
      keystroke, not only on selecting a suggestion — several call sites depend on free text being
      valid (e.g. billing's customer-code field, typed against the loaded customer list rather than
      requiring an exact dropdown pick). One real lint catch during this: an initial version cleared
      a stale highlighted index via `useEffect` + `setState`, which `eslint-plugin-react-hooks`
      correctly flagged (cascading-render risk on every keystroke that shrank the match list) —
      replaced with a derived `activeIndex` computed inline instead of stored state.
- [x] **Visually verified in the real Edge browser** (screenshots retained in the session scratch
      dir, not committed): dropdown renders correctly themed on the billing page, typing "pet"
      filters to the three matching items (`PETROL`, `PET ADDITIVE`, `PET`/"Petrol"), two
      `ArrowDown` presses correctly highlights the third option, `Enter` selects it and closes the
      dropdown, clicking an option with the mouse selects it without losing focus first, `Escape`
      and clicking outside both close without changing the value.

Verified: full test suite (73/73 — one transient failure on the very first post-change `npm run
test` run, traced to a stale SQLite file lock from a just-killed dev-server process, not a real
regression; reran clean twice), `typecheck`/`lint`/`build` all clean (21 web routes, unchanged — no
new routes, only a component rewrite). Real end-to-end browser verification of both the offline
sync and the new Combobox, detailed above — the first time either has been possible in this
project rather than relying on code review alone.

**Notes for the next session:**
- `playwright-core` + a system Edge/Chrome executable is now a known-working recipe for real
  browser verification in this environment when no `chromium-cli` is available — worth reusing
  rather than rediscovering, and worth writing up as a project skill (`/run-skill-generator`) if a
  future session wants to save the rediscovery cost.
- The Combobox's 50-row render cap hasn't been stress-tested against a catalog larger than this
  demo's ~69 items — fine today, worth revisiting if the item master grows materially.

## Session 16 — WhatsApp Invoice Module, Community edition

User asked to build `PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf` — a module brief that had
been sitting untracked/unstarted since it was first mentioned at the end of Session 15. Built
Phase 1 (Community edition) exactly as scoped: no WhatsApp Business API, no browser automation, no
unofficial WhatsApp client library — just a `wa.me` deep link, the same one a person would type by
hand, plus a manual-PDF-attach notice. The Professional-edition provider architecture (WhatsApp
Business, Email, SMS) is built to the same interface but stubbed "coming soon," per the brief.

- [x] **Backend**: `communication_settings` (singleton: `whatsapp_enabled`, `default_country_code`,
      `message_template`, `auto_open_whatsapp`, `business_api_enabled`) and `communication_log`
      (one row per send attempt: bill, customer, mobile number, channel, status, remarks) tables.
      `GET`/`PUT /communication/settings` (read: any signed-in staff; write: super_admin/owner,
      matching `tenant`'s gate), `POST`/`GET /communication/log` (write: super_admin/owner/operator
      — the same three roles billing itself is gated to). 5 new tests
      (`communicationSettings.test.ts`, `communicationLog.test.ts`) — 78 total (was 73).
- [x] **Frontend architecture** (`apps/web/lib/communication/`): `ICommunicationProvider` interface,
      `CommunicationService` (Billing -> CommunicationService -> Provider, per the brief),
      `WhatsAppCommunityProvider` (the one real implementation — builds the wa.me URL, opens it,
      triggers a PDF download alongside since wa.me can't attach a file via URL),
      `SharePdfProvider` (native OS share sheet via the Web Share API, falls back to a plain
      download), `ComingSoonProvider` (one stub class parameterized by channel, used for
      `whatsapp_business`/`email`/`sms` — architected, not half-wired). `lib/communication/
      mobileNumber.ts` (normalize/validate — bare 10-digit numbers get the default country code
      prepended) and `template.ts` (`{customerName}`/`{tenantName}`/`{billNo}`/`{amount}`
      placeholder substitution).
- [x] **`SendInvoiceButton`** (`apps/web/components/SendInvoiceButton.tsx`) — a generic "Send
      Invoice" dropdown with WhatsApp and Share PDF active, Email/SMS visibly greyed out with a
      "Coming soon" badge rather than hidden. If a valid mobile number is already known (from
      Customer Master, for a credit sale) and `auto_open_whatsapp` is on, WhatsApp sends
      immediately; otherwise it shows a confirm step with an editable number field first — covers
      both "registered customer, auto-filled" and "walk-in, operator types a number" from the
      brief, and "operator can edit the number before sending" in both cases. Wired into the
      billing page in both places an invoice can appear: right after creating one, and when
      looking an existing bill back up (not shown for a cancelled bill).
- [x] **Settings > Communication** section (`apps/web/app/(app)/settings/page.tsx`) — Enable
      WhatsApp / Auto Open WhatsApp toggles, default country code, message template (with a
      placeholder-syntax hint), and a visibly-disabled "WhatsApp Business API — Coming soon" row
      (Professional edition, stored but inert).
- [x] **One real bug found and fixed via browser testing, one false lead corrected**: initially
      passed `"noopener,noreferrer"` to `window.open()` for security, then used the return value to
      detect a blocked popup — except a from-scratch Playwright repro (`window.open()` on a bare
      page, no app code involved) proved this specific automation setup returns `null` from
      `window.open()` regardless of whether `noopener` is present at all. So the popup-blocked
      *detection mechanism* couldn't be verified true-vs-false-positive via this harness either
      way — but `win.opener = null` (set by hand right after opening, instead of via the
      `noopener` flag) is still the objectively better technique for real users, since it gets the
      same reverse-tabnabbing protection without engine-dependent return-value risk. Kept the fix,
      corrected the code comment to not overclaim what was actually proven.

**Verified for real** (`playwright-core` + system Edge, same recipe as Session 15): logged in,
opened Settings > Communication and confirmed the template loaded; created a cash bill (no
customer attached); clicked Send Invoice → WhatsApp with no known number → correctly showed the
confirm step (proving the "prompt for a number" path); typed a number, clicked Open WhatsApp →
captured the actual new-tab URL via Playwright's `context.on("page")` and confirmed it was a real
`api.whatsapp.com/send/...` redirect with the phone number correctly country-coded
(`919876543210` from a typed `9876543210`) and the message template correctly rendered with the
real tenant name (`SRINIVASA AGENCIES`), bill number, and amount substituted in. Confirmed the
send attempt was persisted to `communication_log` with the exact result message shown in the UI.
Full suite: 78/78 (two failures on one `npm run test` pass turned out to be a **pre-existing**
`backup.test.ts`/`dataReset.test.ts` race over a shared OS-temp `backups/` directory — reran in
isolation and together, confirmed unrelated to this session's changes, not a regression).
`typecheck`/`lint`/`build` all clean (21 web routes, unchanged — no new routes, only new
components/sections on existing pages). Cancelled the test bills created during verification
afterward so the real demo dataset stayed clean; left the resulting `communication_log` rows in
place (no delete endpoint exists for logs anywhere in this app, `audit_logs` included — logs are
treated as append-only across every session, not scrubbed after testing).

**Notes for the next session:**
- The popup-blocked-vs-success distinction in `WhatsAppCommunityProvider` is unverified by
  automation for the reason above (this Playwright+Edge combo can't distinguish the two via
  `window.open()`'s return value) — a real, non-automated click-through would be the only way to
  fully confirm it, if that ever becomes available.
- No `.env.example` still — same gap flagged since Session 14, unrelated to this feature but worth
  batching in whenever someone does add one.
- `docs/MODULES.md` hasn't been updated to reflect this new capability — it's a genuinely new
  feature (not a legacy-menu item), so there's nothing there to cross-reference, but worth knowing
  it's the one doc this session didn't touch.

## Session 17 — QR-code invoice sharing (Community edition)

User asked: with a QR code already generated (payment QR), could a customer scan a code and get
their bill onto their own phone — an "easy way with the community edition." Asked the user to pick
between three feasible flows (WhatsApp can't be made to push a message to an arbitrary number
without the Business API, which Community edition explicitly excludes); they picked the public
invoice-link option over a wa.me request-to-shop flow or a share-to-any-contact flow.

- [x] **New JWT audience**: `InvoiceTokenPayload` (`role: "invoice"`, `sub` = bill number as a
      string) in `plugins/auth.ts`, alongside the existing staff/customer payload types. Scoped to
      exactly one bill, short-lived (30 min, `SHARE_LINK_TTL` in `routes/bills.ts`).
- [x] **`GET /bills/:billNo/share-link`** (any signed-in staff, same gate as the existing PDF
      route) mints one and returns `{ token, url, expiresInSeconds }`, `url` pointing at
      `apps/web`'s new `/i/[billNo]?t=...` page.
- [x] **`routes/publicInvoice.ts`** (new, no login of any kind): `GET /public/invoice/:billNo` and
      `GET /public/invoice/:billNo/pdf`, both gated purely on a valid `t` token scoped to that
      exact bill number — verified via `fastify.jwt.verify()` called directly on the query-string
      token, not `request.jwtVerify()` (there's no Authorization header on a page a phone camera
      opens cold).
- [x] **Real security fix found and closed while wiring this up, before it shipped**: adding the
      `"invoice"` role to the JWT payload union broke `requireRole`'s type check (an `"invoice"`
      token isn't a `Role`), which surfaced that `fastify.authenticate` — used by several
      staff-only `GET /bills/*` routes (`/bills/recent`, `/bills/:billNo`, `/bills/:billNo/pdf`,
      the new `/bills/:billNo/share-link`) — only checks that a JWT is *valid*, not that its role
      is staff. Without a fix, a QR-scanned invoice token (or even an existing customer-portal
      token) could hit any of those routes directly, e.g. minting a fresh share-link for an
      *arbitrary* bill number rather than the one it was actually scoped to. Fixed by making
      `authenticate` reject `"customer"`/`"invoice"` roles the same way `requireRole` already did.
      Verified directly over HTTP (see below) — this was a real, exploitable gap this session's
      own change would have introduced, not a hypothetical.
- [x] **`SendInvoiceButton`** gained a third dropdown action, "Customer scans QR" — mints a
      share-link and renders it as a QR image (client-side, `qrcode` npm package, new dependency
      in `apps/web`) with a copy-link fallback. Same component, same two call sites as the
      WhatsApp/Share PDF actions (billing page's just-created and looked-up invoice views) — no
      new props needed.
- [x] **`apps/web/app/i/[billNo]/page.tsx`** (new, public route, no `(app)` layout/session) — what
      the customer's phone actually lands on: tenant letterhead, line items, totals, amount in
      words, a cancelled-bill banner if applicable, a plain PDF download link, and a Share button
      (Web Share API with a file attachment where supported, falling back to a plain download —
      same pattern as `SharePdfProvider`, reimplemented standalone since this page has no staff
      token to reuse `downloadAuthed()` with).
- [x] `packages/shared-types`: `ShareLinkResponse`, `PublicInvoice` — the wire shapes for the two
      new endpoints above.

Verified: `typecheck`/`lint`/`build` all clean (new `/i/[billNo]` route builds as dynamic, ƒ).
Full HTTP pass against a running server: minted a share-link for a real bill, fetched
`/public/invoice/:billNo` with the valid token (correct bill/tenant/totals came back), fetched the
PDF (`file` confirmed a real single-page PDF), confirmed a *wrong* bill number with the same
token 401s, confirmed no token and a garbage token both 401 with the same user-facing message.
Confirmed the security fix directly: the invoice token gets 403 from `/bills/recent` and from
minting a share-link for a different bill; a real staff token is unaffected on both. Cancelled the
test bill afterward. **Not verified**: no real browser scan-and-open of the QR code itself (no
camera/phone available in this environment) — the link it encodes was verified to work correctly
via curl, and the QR image generation (`qrcode` client-side) wasn't separately checked in a real
browser rendering pass.

**Notes for the next session:**
- The `SendInvoiceButton` fix above (`authenticate` rejecting non-staff roles) is a general
  hardening, not scoped to QR — worth remembering if any future token audience gets added, since
  the same gap would reopen for it too unless `authenticate` explicitly allow-lists staff roles.
- The 30-minute share-link TTL is a judgment call, not specified by the user — easy to change
  (`SHARE_LINK_TTL` in `routes/bills.ts`) if it turns out too short/long in practice.
- No visual/real-device verification of the QR scan-to-page flow — flag if a real phone or camera
  becomes available to test with, same caveat as every other UI-only-verified feature in this repo.

## Session 18 — Customer Master phone capture (WhatsApp invoice fix)

User reported: for Credit Bills, the Send Invoice button's WhatsApp option should reach the
customer's "designated WhatsApp number... captured from the customer master." Investigation found
`SendInvoiceButton` already pre-fills and (with `auto_open_whatsapp` on, the default) auto-opens
WhatsApp from `customer.phone` for credit sales — that logic was correct and unchanged since
Session 16. The actual gap: **the Customers page had no UI to ever set a customer's `phone` at
all** — not in the create form, not anywhere in the detail panel — despite the backend
(`customersRepo`, `PUT /customers/:code`) fully supporting it since Phase 1. Every credit
customer's `phone` was therefore always null, so the WhatsApp flow always fell back to "type a
number" with nothing pre-filled — not a bug in the WhatsApp module, a missing master-data field in
the UI in front of it.

- [x] **Create-customer form** (`app/(app)/customers/page.tsx`) gained a "WhatsApp / mobile
      number (optional)" input, wired into `api.createCustomer` (its `apps/web/lib/api.ts` type
      didn't include `phone` either — added).
- [x] **New "WhatsApp / mobile number" edit block** in the customer detail panel, same pattern as
      the existing "Order Entry login" email editor (`handleSavePhone`, gated
      `super_admin`/`owner` to match the backend's `PUT /customers/:code` role gate exactly).
      Detail header now also shows the number inline when one is set.

Verified: `typecheck`/`lint`/`build` all clean (still 22 web routes — no new routes, only fields on
an existing page). Full test suite 78/78 (no new repo logic — the backend already supported
`phone` end to end). HTTP pass with the frontend's exact payload shapes: created a credit customer
with a phone via the create-form's payload shape, confirmed `GET` returns it, updated it via the
edit-panel's full-object PUT shape, confirmed the new value persisted, then created and cancelled
a real credit bill against that customer to confirm the whole chain (customer → credit bill →
`due_amount`) still works with a phone on file. Did not re-verify the WhatsApp send mechanism
itself (wa.me URL construction, template rendering, auto-open) — that logic wasn't touched and was
already verified for real in Session 16.

**Notes for the next session:**
- Phone editing is restricted to `super_admin`/`owner` in the UI, matching the backend gate — an
  `operator` (who actually clicks Send Invoice day to day) cannot fix a wrong/missing number
  themselves and has to ask an admin/owner. Flag if that turns out to be friction in practice.
- Still just one `phone` field per customer (no concept of multiple recipients/numbers) — the
  request used the phrase "designated whatsapp numbers" (plural) but the schema and every other
  part of this flow only ever supported one; treated as phrasing, not a multi-recipient request,
  since it wasn't confirmed otherwise.

## Session 19 — env var documentation (reconstructed)

**Not logged at the time** — reconstructed from commit `2c2400a` during a later session; see
`AI_Handoff.md`'s Session 19 entry for the full reconstruction caveat (no verification record
exists for this session beyond what the diff itself proves).

- [x] **`apps/api/.env.example`** and **`apps/web/.env.example`** — every var each app's
      `config.ts` reads, with local-dev defaults and a pointer to where the production value
      actually gets set (Fly.io secrets / Vercel project env vars).
- [x] **`apps/web/.gitignore`**: `!.env.example` exception to its blanket `.env*` rule, so the new
      file isn't silently gitignored.
- [x] **Gap found while backfilling this entry**: `apps/web/.env.example` was missing
      `NEXT_PUBLIC_DESKTOP_CONTROL_PORT` (read by `components/DesktopTitleBar.tsx`, defaults to
      `4098`) — added directly. `scripts/desktop/start.mjs`'s own `API_PORT`/`WEB_PORT`/
      `DESKTOP_CONTROL_PORT` (no `NEXT_PUBLIC_` prefix, read by that standalone Node launcher
      script, not either app) remain undocumented — that script sits outside both workspaces and
      has no `.env.example` of its own today.

## Session 20 — Billing/Reports polish (reconstructed)

**Not logged at the time** — reconstructed from commit `e7354cc`; same caveat as Session 19.

- [x] Billing page: "Walk-in Billing" → "Just Billing"; Sale Type buttons reordered to
      Cash/Credit/Card/UPI.
- [x] GST summary Excel export: Taxable Value/Tax Amount/Total columns now currency-formatted
      (`"₹"#,##0.00`) instead of raw numbers.
- [x] Reports page: fuel (Petrol/Diesel) Qty columns rounded to 3 decimals, keyed off the item
      catalog (`/petrol|diesel/i` against `items.name`) rather than a hardcoded item list; all
      numeric columns right-aligned with tabular figures; dropped the page's `max-w-4xl` cap so
      wide reports (Mileage, HSN) use the full available width.

No schema/route/test changes in either session — route count (22) and test count (78) are
unchanged from Session 18.

## Real remaining gaps (not phase-blocking, carried forward)

- **Full** historical transactional migration (every fiscal year, not just the one 3-month demo
  window above) — materially larger effort, not attempted.
- An output validation harness vs FoxPro reports — no reference FoxPro output exists in this repo
  to validate against; not fabricated.
- Browser-based E2E tests (Playwright/Cypress) — no browser automation tool has been available in
  any session so far.
- Real-world verification of the Docker packaging and CI workflow (Dockerfiles updated Session 10
  for the shared-types build step, but neither has actually been run — no Docker in this dev
  environment; the repo is now on git, per Session 14, but a real Actions run still hasn't happened).
- **Google SSO and the desktop kiosk launcher (Session 14) are unverified beyond typecheck/lint/build**
  — no real Google OAuth credentials and no Chromium browser have been available in this environment
  to actually exercise either end-to-end.
- ~~No `.env.example` anywhere in the repo~~ — closed in Session 19 (`apps/api/.env.example`,
  `apps/web/.env.example`). The desktop launcher script's own three env vars are still
  undocumented (see Session 19 above) — a much smaller residual gap than the original.
- **No verification record for Sessions 19–20** — both were reconstructed from `git show` after
  the fact with no typecheck/lint/build/test pass confirmed to have happened at the time. Worth a
  real pass (`npm run typecheck && npm run lint && npm run build && npm run test`) next time either
  area (env config, billing page, reports page) is touched, to confirm nothing regressed silently.
- See `Project_Status.md`'s "Known gaps" for smaller, accumulated items (date-range query pattern,
  floating-point rounding, `opening_balances` overwrite semantics, the destructured-dynamic-import
  gotcha, the `applyDueRateChanges()` stale-response-snapshot quirk, the `BILL_NO`-isn't-unique
  finding from this session, etc.) — still true, still worth reading before touching related code.
- **`Project_Status.md` was not touched in this backfill pass** — it's the "current reality
  snapshot" doc (not a session log) and was already stale before Sessions 19–20 (its summary line
  still says "six post-roadmap sessions (8–13)" while the body separately covers up through
  Session 18) — a pre-existing gap, not one this pass introduced, but worth a dedicated pass rather
  than folding into this one.
