# PetroPro — Delivery Roadmap

The legacy FoxPro app has **96 tables, 55 programs and 66 reports**. It is rebuilt in phases so each
phase is independently runnable and verifiable against the original.

Legend: ✅ done · 🚧 in progress · ⬜ planned

## Phase 0 — Reverse engineering ✅
- Extract & inventory legacy sources (`legacy/Workarea/`)
- Dump DBF schemas (`legacy/dbf_schema.py`)
- Document data dictionary, ER diagram, migration notes ✅ — module map (`docs/MODULES.md`, legacy
  menu → modern feature mapping) still not written; a documentation gap, not a functional one

## Phase 1 — Foundation & core domain ✅
- Monorepo scaffold (npm workspaces)
- SQLite schema + repository layer + seed data
- Backend: auth (users/roles/JWT), groups, items, customers, vehicles
- Tax engine (GST inclusive/exclusive) + Indian amount-in-words (`money()` port)
- **Headline feature:** attendant entry → cashier pending queue → invoice (vertical slice)
- Web PWA shell (installable, offline app-shell), login, attendant, cashier screens

## Phase 2 — Billing & inventory ✅
- Full bill entry (cash / credit / retail), cancel bill, receipts
- Stock day-book (opening/closing/receipts/damaged/sales/balance), close stock/date
- Purchases, rate changes (scheduled), opening/closing balances
- Duplicate/previous bill & receipt printing

## Phase 3 — Reports & tax ✅
- Item-wise / cashier-wise / bill-wise / group-wise sales (daily/periodic/yearly)
- Stock, purchase, customer statement, ledger, mileage, vehicle, fleet-card reports
- VAT & GST daily/periodic/yearly summaries → PDF + Excel

## Phase 4 — Offline sync & operations ✅
- Offline-first (IndexedDB queue) + LAN sync between attendant tablets and cashier
- Shift management, audit logs, backup/restore, financial-year switch, bulk tax change
- Dashboards & analytics

## Phase 5 — Hardening ✅ (scope adjusted — see notes)
- DBF importer to migrate real historical **master data** (groups/items/customers/vehicles/fleet
  cards/users) ✅ — verified against the actual ~109K-row legacy dataset in `legacy/Workarea/`.
  Historical **transactional** data (decades of monthly bill/stock/purchase/receipt tables) is
  **not** migrated — a materially larger effort than this pass covered; see
  `docs/MIGRATION_NOTES.md`.
- Output validation harness vs FoxPro reports — **not built.** There's no reference FoxPro report
  output in this repo to validate against; building a harness with nothing to compare to would be
  fabricating a check that doesn't actually check anything. Revisit if real legacy report exports
  become available.
- Automated test suite (`apps/api`) ✅ — ~29 tests covering tax engine, `money()`/amount-in-words,
  billing (walk-in/cancel/settle), shifts, backup/restore, and the customers repo bug from
  Session 5. This was flagged in three consecutive sessions (4, 5, 6) before finally being built.
- CI (`.github/workflows/ci.yml`) ✅ — typecheck, lint, test, build on push/PR. Unverified against a
  real GitHub Actions run since this repo isn't pushed anywhere yet.
- Deployment packaging (Dockerfiles + `docker-compose.yml`) ✅ written, **not build-tested** — no
  Docker available in the dev environment this was built in.
- True browser-based E2E tests (Playwright/Cypress) — **not built.** No browser automation tool was
  available in any session so far; what exists instead is HTTP-level integration coverage
  (the test suite above) plus manual HTTP-driven verification each session.
