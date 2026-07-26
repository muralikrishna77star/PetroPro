# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

PetroPro is a ground-up modernization of a legacy **FoxPro 2.6 DOS** petrol-station billing system
(source in `legacy/Workarea/`: PRG programs, DBF tables, FRX/FRT report forms, indexes) into an
offline-first PWA. The goal is **not** a literal code port — it's reverse-engineering the business
rules (billing, tax, inventory, ledgers) and rebuilding them as a modern app while preserving every
legacy behavior. See [PetroPro_Claude_Master_Prompt.pdf](PetroPro_Claude_Master_Prompt.pdf) for the
original brief this project is built from.

**Repo state:** the project is generated incrementally by phase (see below) and is currently early —
`apps/` (the actual Next.js/Fastify code) does not exist yet. Most of what's on disk today is Phase 0
reverse-engineering output (`docs/`, `legacy/dbf_schema.py`) plus the planned monorepo config
(`package.json` workspaces for `apps/*`, `packages/*`).

## Delivery phases

Defined in [docs/ROADMAP.md](docs/ROADMAP.md) — check it for current ✅/🚧/⬜ status before assuming
a feature exists:

0. Reverse engineering (extract legacy sources, dump DBF schemas, write data dictionary/ER
   diagram/module map/migration notes) — done
1. Foundation: monorepo scaffold, SQLite schema + repository layer, auth, tax engine, the
   attendant→cashier→invoice vertical slice, PWA shell — in progress
2. Billing & inventory: full bill entry, stock day-book, purchases, rate changes
3. Reports & tax: sales reports, VAT/GST summaries → PDF + Excel
4. Offline sync & operations: IndexedDB queue + LAN sync, shifts, audit logs, backup/restore
5. Hardening: DBF importer for real historical data, validation harness vs FoxPro, E2E tests, CI

## Commands

```powershell
npm install
npm run seed        # create + seed the SQLite database (apps/api)
npm run dev:api      # Fastify API on http://localhost:4000
npm run dev:web      # Next.js PWA on http://localhost:3000
npm run dev          # both, concurrently
npm run build        # build api then web
npm run test         # apps/api test suite
```

Default seeded login: `admin` / `admin123`.

These are npm-workspace scripts (`apps/api`, `apps/web`) declared in the root `package.json`; once
those workspace packages exist, check their own `package.json` for how to run a single test or a
narrower build.

## Architecture

**Tech stack:** Next.js (App Router) + React + TypeScript + Tailwind for the frontend PWA; Node.js +
Fastify REST API backend; SQLite via a repository layer (chosen for DBF-import compatibility, not a
raw ORM mapping); local users/roles with JWT auth; PDF/Excel report generation.

**Legacy → modern schema mapping** — read [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md) before
touching any billing/inventory logic. Key structural difference: the legacy system stored
transactions in **per-month, per-financial-year DBF tables** (`JANBIL18`, `FEBBIL18`, … where `18` =
FY2018-19); the modern schema consolidates all of these into single tables with real date columns and
a `fin_year` dimension. Prices/rates exist in both before-tax (`*BTX`) and tax-inclusive (`*TAX`)
forms — fuel is priced tax-inclusive by convention.

**Core domain model** (full detail + relationships in
[docs/ER_DIAGRAM.md](docs/ER_DIAGRAM.md)):
- `groups` → `items` → `bill_lines` / `stock_daybook` / `purchases` / `rate_changes`
- `customers` → `vehicles`, `fleet_cards`, `bills`, `receipts`, `opening_balances`, `ledger_entries`
- `users` → `bills`, `pending_transactions`, `audit_logs`, `shifts`
- `bills` ⟷ `bill_lines` (1:N) — the legacy system had no bill header, only lines; PetroPro adds an
  explicit `bills` table carrying totals/payment/status
- **New attendant→cashier flow** (not in the legacy system): `pending_transactions` is where an
  attendant's fuel entry (vehicle, item, qty/amount, odometer) lands; a cashier picks it up, optionally
  adds items, and it becomes exactly one settled bill (`pending_transactions.bill_no` links the two)
- New PWA-only tables: `pending_transactions`, `shifts`, `audit_logs`, `sync_queue` (offline mutation
  queue for LAN sync)

**Roles:** legacy `USERTAB.LEVEL` (1=admin/manager, 2=cashier, with menu bars hidden for level 2) maps
to modern roles `admin`/`manager`/`cashier`; **attendant** is a new role introduced by the PWA with no
legacy equivalent.

**New features beyond the legacy system** (from the master prompt): fuel-attendant mobile PWA for
Android, instant attendant→cashier pending queue, offline sync over LAN, dashboards/analytics, shift
management, fleet customers, audit logs, backup/restore.

## Working with legacy sources

- `legacy/Workarea/` is the original FoxPro install (PRG/DBF/FRX/FRT/indexes/sample data) — **read-only
  reference**, never modify it.
- `legacy/dbf_schema.py` dumps DBF table structure (fields, types, row counts) from `.DBF` files —
  run it against `legacy/Workarea/*.DBF` when you need ground truth on a table not yet in the data
  dictionary, rather than guessing from the FoxPro source alone.
- When a doc (data dictionary, ER diagram) and the actual DBF/PRG source disagree, the source wins —
  update the doc.

## Daily prompt log

`daily-prompts/` keeps a dated log of chat prompts so work can resume across sessions
(`daily-prompts/chat-prompts.txt`, exported via `export-prompts.ps1` / `export_prompts.py`). Not part
of the application itself — informational only, don't treat it as project documentation.
