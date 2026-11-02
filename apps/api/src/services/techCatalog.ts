import type {
  TechCategory,
  TechCostModel,
  TechProviderIntegration,
  TechServiceLink,
} from "@petropro/shared-types";

/**
 * What PetroPro is built and run on, as found in this repo (package.json files, fly.toml,
 * Dockerfiles, .github/workflows, .env.example, AI_Handoff.md's deploy notes). Static because
 * none of it is discoverable at runtime from the deployed API alone; techCatalog.test.ts fails
 * if a `declared` version here drifts from the package.json it was copied from.
 *
 * Nothing here records a subscription, plan or price: those come only from a super admin
 * (tech_subscriptions) or a provider API check (tech_provider_checks).
 */
export interface CatalogEntry {
  id: string;
  name: string;
  category: TechCategory;
  provider: string;
  cost_model: TechCostModel;
  critical: boolean;
  /** Declared version, and which manifest declared it. Runtime versions are filled in by
   *  services/techDashboard.ts for the entries it can actually ask (Node, Fastify, SQLite). */
  declared?: { version: string; source: "package.json" | "fly.toml"; manifest: string; dependency: string };
  /** Extra package versions shown as facts, checked against package.json the same way. */
  packages?: { dependency: string; version: string; manifest: string }[];
  purpose: string;
  used_in: string[];
  impact_if_unavailable: string;
  links: TechServiceLink[];
  facts?: { label: string; value: string }[];
  /** Charged on another service's invoice. Such entries never carry their own subscription,
   *  so the same money isn't counted twice. */
  billed_with?: string;
  integration?: { provider: TechProviderIntegration; verifies: string };
}

const WEB = "apps/web/package.json";
const API = "apps/api/package.json";
const ROOT = "package.json";

/** Owner of the origin remote. A GitHub plan only applies here if it's this account's. */
export const GITHUB_REPO_OWNER = "muralikrishna77star";

export const TECH_CATALOG: CatalogEntry[] = [
  // --- Frontend -----------------------------------------------------------------------------
  {
    id: "nextjs",
    name: "Next.js",
    category: "frontend",
    provider: "Vercel (open-source project)",
    cost_model: "open_source",
    critical: true,
    declared: { version: "16.2.10", source: "package.json", manifest: WEB, dependency: "next" },
    purpose: "React framework (App Router) that builds and serves the PetroPro web app / PWA.",
    used_in: ["apps/web/app/**", "apps/web/next.config.ts"],
    impact_if_unavailable: "The web app cannot be built. A library, not a service: nothing to renew.",
    links: [{ label: "Documentation", url: "https://nextjs.org/docs" }],
    facts: [{ label: "Fonts", value: "Inter, Poppins, Roboto Mono via next/font/google: downloaded at build time, then served by the app itself" }],
  },
  {
    id: "react",
    name: "React",
    category: "frontend",
    provider: "Meta (open-source project)",
    cost_model: "open_source",
    critical: true,
    declared: { version: "19.2.4", source: "package.json", manifest: WEB, dependency: "react" },
    purpose: "UI component library every screen is written in.",
    used_in: ["apps/web/app/**", "apps/web/components/**"],
    impact_if_unavailable: "The web app cannot be built. A library, not a service: nothing to renew.",
    links: [{ label: "Documentation", url: "https://react.dev" }],
  },
  {
    id: "tailwind",
    name: "Tailwind CSS",
    category: "frontend",
    provider: "Tailwind Labs (open-source project)",
    cost_model: "open_source",
    critical: false,
    declared: { version: "^4", source: "package.json", manifest: WEB, dependency: "tailwindcss" },
    purpose: "Utility CSS used for all styling, theming and the color styles.",
    used_in: ["apps/web/app/globals.css", "apps/web/components/**"],
    impact_if_unavailable: "Styling can't be rebuilt. A library, not a service.",
    links: [{ label: "Documentation", url: "https://tailwindcss.com/docs" }],
  },
  {
    id: "ui-libraries",
    name: "UI libraries (charts, icons, animation, QR)",
    category: "frontend",
    provider: "Open-source projects",
    cost_model: "open_source",
    critical: false,
    packages: [
      { dependency: "recharts", version: "^3.10.1", manifest: WEB },
      { dependency: "lucide-react", version: "^1.27.0", manifest: WEB },
      { dependency: "framer-motion", version: "^12.42.2", manifest: WEB },
      { dependency: "qrcode", version: "^1.5.4", manifest: WEB },
    ],
    purpose: "Dashboard charts (recharts), icons (lucide-react), animations (framer-motion) and invoice/payment QR codes (qrcode).",
    used_in: ["apps/web/app/(app)/dashboard", "apps/web/components/**", "apps/web/components/PaymentQrPanel.tsx"],
    impact_if_unavailable: "Only at build time. QR codes are generated in the browser, so no QR service is involved.",
    links: [],
  },
  {
    id: "pwa",
    name: "PWA service worker & offline queue",
    category: "frontend",
    provider: "Browser platform (built in)",
    cost_model: "built_in",
    critical: false,
    purpose: "Installable app shell (manifest + service worker) and an IndexedDB queue that holds bills entered while offline until the API is reachable.",
    used_in: ["apps/web/public/sw.js", "apps/web/public/manifest.json", "apps/web/app/register-sw.tsx", "apps/web/lib/offlineQueue.ts"],
    impact_if_unavailable: "Offline entry and home-screen install stop working; online use is unaffected.",
    links: [],
  },

  // --- Backend ------------------------------------------------------------------------------
  {
    id: "nodejs",
    name: "Node.js",
    category: "backend",
    provider: "OpenJS Foundation (open-source project)",
    cost_model: "open_source",
    critical: true,
    declared: { version: ">=22.5.0", source: "package.json", manifest: ROOT, dependency: "engines.node" },
    purpose: "Runtime for the API (and its built-in node:sqlite driver). The API Docker image uses node:22-alpine.",
    used_in: ["apps/api/**", "apps/api/Dockerfile"],
    impact_if_unavailable: "The API cannot run.",
    links: [{ label: "Release schedule", url: "https://nodejs.org/en/about/previous-releases" }],
  },
  {
    id: "fastify",
    name: "Fastify (+ @fastify/cors)",
    category: "backend",
    provider: "Fastify (open-source project)",
    cost_model: "open_source",
    critical: true,
    declared: { version: "^5.1.0", source: "package.json", manifest: API, dependency: "fastify" },
    packages: [{ dependency: "@fastify/cors", version: "^10.0.1", manifest: API }],
    purpose: "HTTP framework for every REST endpoint the web app calls.",
    used_in: ["apps/api/src/app.ts", "apps/api/src/routes/**"],
    impact_if_unavailable: "The API cannot run.",
    links: [{ label: "Documentation", url: "https://fastify.dev/docs/latest/" }],
  },
  {
    id: "typescript",
    name: "TypeScript",
    category: "backend",
    provider: "Microsoft (open-source project)",
    cost_model: "open_source",
    critical: false,
    declared: { version: "^5.7.2", source: "package.json", manifest: API, dependency: "typescript" },
    packages: [{ dependency: "tsx", version: "^4.19.2", manifest: API }],
    purpose: "Language for the API, web app and the shared-types package; tsx runs the API in dev and the tests.",
    used_in: ["apps/**", "packages/shared-types"],
    impact_if_unavailable: "Build/test tooling only. Nothing runs it in production.",
    links: [],
  },

  // --- Database & storage -------------------------------------------------------------------
  {
    id: "sqlite",
    name: "SQLite (node:sqlite)",
    category: "database",
    provider: "Built into Node.js",
    cost_model: "built_in",
    critical: true,
    purpose: "The only database: all bills, stock, customers, users and settings, in one file.",
    used_in: ["apps/api/src/db/client.ts", "apps/api/src/db/schema.ts", "apps/api/src/repositories/**"],
    impact_if_unavailable: "Everything stops. The file lives on the Fly.io volume, so it depends on that volume.",
    links: [],
  },
  {
    id: "fly-volume",
    name: "Fly.io volume (database disk)",
    category: "storage",
    provider: "Fly.io",
    cost_model: "managed_service",
    critical: true,
    billed_with: "flyio",
    purpose: "Persistent disk mounted at /repo/data holding petropro.db and the backups folder.",
    used_in: ["fly.toml [[mounts]]"],
    impact_if_unavailable: "The API loses its database. All data and on-volume backups are on this one disk.",
    links: [{ label: "Fly.io dashboard", url: "https://fly.io/dashboard" }],
    facts: [
      { label: "Volume name", value: "petropro_data" },
      { label: "Mount point", value: "/repo/data" },
    ],
  },
  {
    id: "backups",
    name: "Database backups",
    category: "storage",
    provider: "PetroPro (self-hosted)",
    cost_model: "self_hosted",
    critical: false,
    purpose: "Settings → Backup copies of the SQLite file, made on demand and before restores or data resets.",
    used_in: ["apps/api/src/services/backup.ts", "apps/api/src/routes/backup.ts"],
    impact_if_unavailable: "No restore point. Backups sit on the same volume as the database, so they are not off-site.",
    links: [],
  },

  // --- Hosting & deployment -----------------------------------------------------------------
  {
    id: "flyio",
    name: "Fly.io (API hosting)",
    category: "hosting",
    provider: "Fly.io",
    cost_model: "managed_service",
    critical: true,
    purpose: "Runs the API container and its database volume.",
    used_in: ["fly.toml", "apps/api/Dockerfile"],
    impact_if_unavailable: "The API and database go offline: no billing, login or reports from any device.",
    links: [
      { label: "App dashboard", url: "https://fly.io/apps/petropro-api" },
      { label: "Billing (personal org)", url: "https://fly.io/dashboard/personal/billing" },
      { label: "How Fly.io billing works", url: "https://docs.fly.io/about/billing" },
    ],
    facts: [
      { label: "App", value: "petropro-api" },
      { label: "Primary region", value: "sin" },
      { label: "VM", value: "shared-cpu-1x, 512mb" },
      { label: "Always-on machines", value: "1 (min_machines_running)" },
      { label: "Deploys", value: "Manual: fly deploy --remote-only -a petropro-api" },
      { label: "Billing API", value: "None documented, so record billing manually" },
    ],
  },
  {
    id: "vercel",
    name: "Vercel (web hosting)",
    category: "hosting",
    provider: "Vercel",
    cost_model: "managed_service",
    critical: true,
    purpose: "Hosts the Next.js web app / PWA.",
    used_in: [".vercelignore", "apps/web"],
    impact_if_unavailable: "Staff can't load the web app (installed PWAs may still open cached screens but can't reach new pages).",
    links: [
      { label: "Dashboard", url: "https://vercel.com/dashboard" },
      { label: "Billing", url: "https://vercel.com/account/billing" },
    ],
    facts: [
      { label: "Production URL", value: "petropro-demo.vercel.app" },
      { label: "Deploys", value: "Manual: vercel --prod (not connected to git pushes)" },
    ],
    integration: { provider: "vercel", verifies: "Plan name (hobby / pro / enterprise) only" },
  },
  {
    id: "docker",
    name: "Docker",
    category: "deployment",
    provider: "Docker (open-source engine)",
    cost_model: "open_source",
    critical: false,
    purpose: "Dockerfiles build the API image Fly.io runs; docker-compose.yml runs API + web on one machine for self-hosting.",
    used_in: ["apps/api/Dockerfile", "apps/web/Dockerfile", "docker-compose.yml"],
    impact_if_unavailable: "Fly.io builds remotely (--remote-only), so only local/self-hosted builds are affected.",
    links: [],
    facts: [{ label: "Base image", value: "node:22-alpine" }],
  },
  {
    id: "deploy-clis",
    name: "Deployment CLIs (flyctl, Vercel CLI)",
    category: "deployment",
    provider: "Fly.io / Vercel",
    cost_model: "open_source",
    critical: false,
    purpose: "Used from a developer machine to deploy the API (flyctl) and the web app (vercel).",
    used_in: ["AI_Handoff.md deploy notes"],
    impact_if_unavailable: "No new deploys; the running app is unaffected.",
    links: [],
  },
  {
    id: "github",
    name: "GitHub (source repository)",
    category: "source_control",
    provider: "GitHub",
    cost_model: "managed_service",
    critical: false,
    purpose: "Hosts the source code (origin remote).",
    used_in: ["git remote origin"],
    impact_if_unavailable: "No pushes/pulls or CI; the running app is unaffected.",
    links: [
      { label: "Repository", url: "https://github.com/muralikrishna77star/PetroPro" },
      { label: "Billing", url: "https://github.com/settings/billing" },
    ],
    facts: [{ label: "Repository", value: "muralikrishna77star/PetroPro" }],
    integration: { provider: "github", verifies: "Plan name of the token's account only" },
  },
  {
    id: "github-actions",
    name: "GitHub Actions (CI)",
    category: "deployment",
    provider: "GitHub",
    cost_model: "managed_service",
    critical: false,
    billed_with: "github",
    purpose: "Typecheck, lint, test and build on every push/PR (.github/workflows/ci.yml).",
    used_in: [".github/workflows/ci.yml"],
    impact_if_unavailable: "No automatic checks; deploys don't depend on it.",
    links: [{ label: "Actions runs", url: "https://github.com/muralikrishna77star/PetroPro/actions" }],
    facts: [
      {
        label: "Trigger",
        value: "push to main + pull requests. This repo's branch is master, so direct pushes don't run CI.",
      },
    ],
  },

  // --- Authentication -----------------------------------------------------------------------
  {
    id: "local-auth",
    name: "Local accounts + JWT",
    category: "authentication",
    provider: "PetroPro (self-hosted)",
    cost_model: "self_hosted",
    critical: true,
    declared: { version: "^9.0.1", source: "package.json", manifest: API, dependency: "@fastify/jwt" },
    packages: [{ dependency: "bcryptjs", version: "^2.4.3", manifest: API }],
    purpose: "User-id/password sign-in (bcrypt hashes) and the signed JWTs every API call carries; also signs QR invoice links.",
    used_in: ["apps/api/src/plugins/auth.ts", "apps/api/src/routes/auth.ts", "apps/api/src/services/auth.ts"],
    impact_if_unavailable: "Nobody can sign in.",
    links: [],
  },
  {
    id: "google-signin",
    name: "Google Sign-In (OAuth 2.0)",
    category: "authentication",
    provider: "Google Cloud",
    cost_model: "free_service",
    critical: false,
    purpose: "Optional \"Sign in with Google\" for staff whose email is on their user record.",
    used_in: ["apps/api/src/routes/googleAuth.ts", "apps/web/app/login"],
    impact_if_unavailable: "The Google button fails; user-id/password sign-in still works.",
    links: [
      { label: "OAuth credentials", url: "https://console.cloud.google.com/apis/credentials" },
      { label: "Google Cloud billing", url: "https://console.cloud.google.com/billing" },
    ],
  },

  // --- Messaging, documents, monitoring, domains --------------------------------------------
  {
    id: "whatsapp",
    name: "WhatsApp click-to-chat (wa.me links)",
    category: "messaging",
    provider: "WhatsApp (Meta)",
    cost_model: "free_service",
    critical: false,
    purpose: "Invoice sharing opens WhatsApp with a pre-filled message. No API, account or key is involved.",
    used_in: ["apps/web/lib/communication", "apps/web/components/SendInvoiceButton.tsx", "apps/api/src/routes/publicInvoice.ts"],
    impact_if_unavailable: "Staff can't send invoices over WhatsApp; billing is unaffected.",
    links: [],
    facts: [{ label: "WhatsApp Business API", value: "Not implemented (Settings shows it as coming soon)" }],
  },
  {
    id: "email-sms",
    name: "Email / SMS delivery",
    category: "messaging",
    provider: "None configured",
    cost_model: "not_in_use",
    critical: false,
    purpose: "No email or SMS provider is integrated. The communication log reserves these channels for the future.",
    used_in: [],
    impact_if_unavailable: "Not applicable.",
    links: [],
  },
  {
    id: "documents",
    name: "PDF & Excel generation (pdfkit, exceljs)",
    category: "documents",
    provider: "Open-source projects",
    cost_model: "open_source",
    critical: false,
    declared: { version: "^0.19.1", source: "package.json", manifest: API, dependency: "pdfkit" },
    packages: [{ dependency: "exceljs", version: "^4.4.0", manifest: API }],
    purpose: "Invoice, receipt and statement PDFs, and GST/report Excel exports, generated inside the API.",
    used_in: ["apps/api/src/services/invoicePdf.ts", "apps/api/src/services/customerStatementPdf.ts", "apps/api/src/services/gstExcel.ts"],
    impact_if_unavailable: "Build-time libraries; no external service.",
    links: [],
  },
  {
    id: "monitoring",
    name: "Monitoring / error tracking",
    category: "monitoring",
    provider: "None configured",
    cost_model: "not_in_use",
    critical: false,
    purpose: "No uptime monitor, error tracker or log service is set up. The API exposes GET /health, but nothing polls it.",
    used_in: ["apps/api/src/app.ts (/health)"],
    impact_if_unavailable: "Outages are only noticed when someone uses the app.",
    links: [],
  },
  {
    id: "domains",
    name: "Domains",
    category: "domains",
    provider: "Platform subdomains (Vercel / Fly.io)",
    cost_model: "free_service",
    critical: false,
    purpose: "No custom domain is configured in this repo; the web app uses its vercel.app subdomain.",
    used_in: [],
    impact_if_unavailable: "Subdomains go with their hosting platform.",
    links: [],
    facts: [
      { label: "Web", value: "petropro-demo.vercel.app" },
      { label: "API", value: "Not recorded in the repo (Vercel's NEXT_PUBLIC_API_URL holds it)" },
    ],
  },
  {
    id: "desktop-kiosk",
    name: "Desktop kiosk launcher",
    category: "desktop",
    provider: "Local browser (Chrome / Edge / Brave)",
    cost_model: "built_in",
    critical: false,
    purpose: "scripts/desktop/start.mjs runs the API + web locally and opens them in a chromeless browser window.",
    used_in: ["scripts/desktop/start.mjs"],
    impact_if_unavailable: "Only the desktop shortcut is affected.",
    links: [],
  },
];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return TECH_CATALOG.find((e) => e.id === id);
}

/** Only these can hold a subscription record of their own. */
export function canRecordSubscription(entry: CatalogEntry): boolean {
  return !entry.billed_with && (entry.cost_model === "managed_service" || entry.cost_model === "free_service");
}
