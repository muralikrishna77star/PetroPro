# PetroPro

**The Complete Petrol Station Management Platform** — a modern, offline-first Progressive Web App
that reverse-engineers and replaces a legacy **FoxPro 2.6 DOS** petrol-station billing system while
preserving its business rules.

> This repository is generated **incrementally**. See [docs/ROADMAP.md](docs/ROADMAP.md) for the phase
> plan and current status.

## Tech stack

| Layer      | Technology                                             |
| ---------- | ------------------------------------------------------ |
| Frontend   | Next.js (App Router), React, TypeScript, Tailwind, PWA |
| Backend    | Node.js + Fastify, REST APIs, TypeScript               |
| Data       | SQLite via a repository layer (DBF import compatible)  |
| Auth       | Local users & roles (JWT)                              |
| Reports    | PDF / Excel / print-ready invoices                     |

## Monorepo layout

```
apps/
  api/     Fastify REST backend (auth, catalog, transactions, invoices, reports)
  web/     Next.js PWA (attendant, cashier, admin, dashboards)
docs/      Reverse-engineering artifacts (data dictionary, ER diagram, modules, migration)
legacy/    Original FoxPro sources (read-only reference) + DBF inspection tooling
```

## Getting started

```powershell
npm install
npm run seed        # create + seed the SQLite database
npm run dev:api     # start API on http://localhost:4000
npm run dev:web     # start web on http://localhost:3000
```

Default admin login after seeding: **admin / admin123** (change immediately).

To pull in real historical master data (groups/items/customers/vehicles/users) from the legacy
FoxPro install instead of the sample seed data, see [docs/MIGRATION_NOTES.md](docs/MIGRATION_NOTES.md).

## Docker

```
docker compose up --build
```

Runs the API on `localhost:4000` and the web app on `localhost:3000`, with the SQLite database
persisted in a named volume. Run the seed script once inside the container to create the default
admin login:

```
docker compose exec api node apps/api/dist/db/seed.js
```

**Not yet verified against a real Docker install** in this environment (no Docker available to test
with) — the Dockerfiles and compose file are written against standard Next.js
`output: "standalone"` + Node practices, but flag any build issues you hit.

## Documentation

- [Data dictionary](docs/DATA_DICTIONARY.md) — every legacy table + modern mapping
- [ER diagram](docs/ER_DIAGRAM.md) — entity relationships
- [Module map](docs/MODULES.md) — legacy menu → modern features
- [Migration notes](docs/MIGRATION_NOTES.md) — rules, gotchas, DBF import
- [Roadmap](docs/ROADMAP.md) — phased delivery plan
