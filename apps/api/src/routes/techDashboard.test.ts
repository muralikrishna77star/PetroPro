import test from "node:test";
import assert from "node:assert/strict";
import type { TechDashboard, TechService } from "@petropro/shared-types";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { config } = await import("../config.js");
const { buildApp } = await import("../app.js");
const { auditLogsRepo } = await import("../repositories/auditLogs.js");
const { looksSecret } = await import("../repositories/techSubscriptions.js");
const { runProviderCheck, serviceAlerts, recurringCosts } = await import("../services/techDashboard.js");

db.prepare("INSERT INTO users (user_id, name, password_hash, role) VALUES ('boss', 'Boss', 'x', 'super_admin'), ('own', 'Owner', 'x', 'owner')").run();

const app = await buildApp();
app.log.level = "silent";
test.after(() => app.close());

const { createSession } = await import("../services/sessions.js");
const superToken = app.signAccessToken({ user_id: "boss", role: "super_admin", name: "Boss" }, createSession("boss", "password", undefined).sessionId);
const ownerToken = app.signAccessToken({ user_id: "own", role: "owner", name: "Owner" }, createSession("own", "password", undefined).sessionId);
const call = (method: "GET" | "PUT" | "POST" | "DELETE", url: string, token = superToken, payload?: unknown) =>
  app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as never });

test("every route is super_admin only", async () => {
  for (const [method, url] of [
    ["GET", "/tech-dashboard"],
    ["PUT", "/tech-dashboard/services/flyio/subscription"],
    ["DELETE", "/tech-dashboard/services/flyio/subscription"],
    ["POST", "/tech-dashboard/services/vercel/verify"],
    ["GET", "/tech-dashboard/services/flyio/history"],
  ] as const) {
    assert.equal((await call(method, url, "")).statusCode, 401, `${method} ${url} anonymous`);
    assert.equal((await call(method, url, ownerToken, {})).statusCode, 403, `${method} ${url} owner`);
  }
  const invoiceToken = app.jwt.sign({ sub: "1", role: "invoice" });
  assert.equal((await call("GET", "/tech-dashboard", invoiceToken)).statusCode, 403);
});

test("with nothing recorded, managed services are unknown, never inferred", async () => {
  const res = await call("GET", "/tech-dashboard");
  assert.equal(res.statusCode, 200);
  const dash = res.json() as TechDashboard;
  const fly = dash.services.find((s) => s.id === "flyio")!;
  assert.equal(fly.subscription, null);
  assert.equal(fly.provider_check, null);
  assert.deepEqual(dash.costs.by_currency, []);
  assert.ok(dash.alerts.some((a) => a.service_id === "flyio" && a.kind === "unrecorded_critical"));
  const node = dash.services.find((s) => s.id === "nodejs")!;
  assert.equal(node.version_source, "runtime");
  assert.equal(node.version, process.version.slice(1));
  assert.equal(dash.services.find((s) => s.id === "sqlite")!.version_source, "runtime");
  // The volume is billed on the Fly.io invoice, so it can't carry its own record.
  assert.equal(dash.services.find((s) => s.id === "fly-volume")!.can_record, false);
  assert.deepEqual(dash.services.find((s) => s.id === "vercel")!.integration?.missing, ["VERCEL_API_TOKEN", "VERCEL_TEAM_ID"]);
});

test("manual record: validated, saved, audited with a field diff, and cleared", async () => {
  const bad = await call("PUT", "/tech-dashboard/services/flyio/subscription", superToken, { subscription_status: "maybe" });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /subscription_status must be one of/);
  assert.equal((await call("PUT", "/tech-dashboard/services/flyio/subscription", superToken, { amount: 5 })).statusCode, 400);
  assert.equal((await call("PUT", "/tech-dashboard/services/flyio/subscription", superToken, { renewal_date: "2026-02-30" })).statusCode, 400);
  assert.equal((await call("PUT", "/tech-dashboard/services/nextjs/subscription", superToken, {})).statusCode, 400);
  const volume = await call("PUT", "/tech-dashboard/services/fly-volume/subscription", superToken, {});
  assert.equal(volume.statusCode, 400);
  assert.match(volume.json().error, /billed with Fly\.io/);
  assert.equal((await call("PUT", "/tech-dashboard/services/nope/subscription", superToken, {})).statusCode, 404);

  const saved = await call("PUT", "/tech-dashboard/services/flyio/subscription", superToken, {
    plan: "Pay as you go",
    account_owner: "owner@example.com",
    subscription_status: "active",
    billing_status: "paid",
    billing_frequency: "monthly",
    amount: 12.5,
    currency: "usd",
    next_payment_date: "2026-12-01",
    auto_renew: "yes",
    notes: "Invoices at https://fly.io/dashboard/personal/billing/invoices/2026-10",
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().currency, "USD");
  assert.equal(saved.json().updated_by, "boss");

  await call("PUT", "/tech-dashboard/services/flyio/subscription", superToken, { ...(saved.json() as object), billing_status: "due" });
  // Both rows can share a created_at second, so look them up by action rather than position.
  const logs = auditLogsRepo.list({ entityType: "tech_subscription" });
  const update = logs.find((l) => l.action === "update_tech_subscription")!;
  assert.equal(update.user_id, "boss");
  assert.equal(update.entity_id, "flyio");
  assert.deepEqual(JSON.parse(update.details!).changes, { billing_status: { from: "paid", to: "due" } });
  assert.ok(logs.some((l) => l.action === "create_tech_subscription"));

  const dash = (await call("GET", "/tech-dashboard")).json() as TechDashboard;
  assert.deepEqual(dash.costs.by_currency, [{ currency: "USD", monthly: 12.5, annual: 150, service_count: 1, usage_based_count: 0 }]);

  // Newest first, and only that service's entries.
  const history = await call("GET", "/tech-dashboard/services/flyio/history");
  assert.equal(history.statusCode, 200);
  assert.deepEqual((history.json() as { action: string }[]).map((l) => l.action), ["update_tech_subscription", "create_tech_subscription"]);
  assert.deepEqual((await call("GET", "/tech-dashboard/services/vercel/history")).json(), []);
  assert.equal((await call("GET", "/tech-dashboard/services/nope/history")).statusCode, 404);

  // The shared audit log is open to owners, but this dashboard's entries are not.
  const ownerLogs = await call("GET", "/audit-logs", ownerToken);
  assert.equal(ownerLogs.statusCode, 200);
  assert.ok(!(ownerLogs.json() as { entity_type: string }[]).some((l) => l.entity_type === "tech_subscription"));
  assert.deepEqual((await call("GET", "/audit-logs?entity_type=tech_subscription", ownerToken)).json(), []);
  assert.ok(((await call("GET", "/audit-logs?entity_type=tech_subscription")).json() as unknown[]).length >= 2);

  assert.equal((await call("DELETE", "/tech-dashboard/services/flyio/subscription")).statusCode, 200);
  assert.ok(auditLogsRepo.list({ entityType: "tech_subscription" }).some((l) => l.action === "clear_tech_subscription"));
  assert.equal((await call("DELETE", "/tech-dashboard/services/flyio/subscription")).statusCode, 404);
});

test("credentials and card numbers are refused in any text field", async () => {
  for (const notes of [
    "token: ghp_abcdefghijklmnopqrstuvwxyz0123",
    "password = hunter2",
    "card 4111 1111 1111 1111",
    "key 9f8e7d6c5b4a39281706f5e4d3c2b1a0aabbccdd",
    "fly FlyV1 fm2_lJPECAAAAAAAB",
    "vercel vcp_abcdefghijklmnop",
    "cvv 123",
  ]) {
    const res = await call("PUT", "/tech-dashboard/services/vercel/subscription", superToken, { notes });
    assert.equal(res.statusCode, 400, notes);
    assert.match(res.json().error, /Don't store credentials or card details/);
  }
  assert.equal(looksSecret("Billing contact: accounts@example.com, renews every April"), null);
  assert.equal(looksSecret("Order 1234 5678 9012 3456"), null); // not a valid card number
});

test("verify: refused when not configured, and the result never carries the token", async () => {
  const notConfigured = await call("POST", "/tech-dashboard/services/vercel/verify");
  assert.equal(notConfigured.statusCode, 400);
  assert.match(notConfigured.json().error, /VERCEL_API_TOKEN, VERCEL_TEAM_ID/);
  assert.equal((await call("POST", "/tech-dashboard/services/flyio/verify")).statusCode, 400);

  config.vercelApiToken = "vercel-secret-token";
  config.vercelTeamId = "team_abc";
  config.githubToken = "gh-secret-token";
  try {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const vercel = await runProviderCheck("vercel", async (url, init) => {
      seen = { url, headers: init.headers };
      return { ok: true, status: 200, json: async () => ({ slug: "my-team", billing: { plan: "pro" } }) };
    });
    assert.equal(seen!.url, "https://api.vercel.com/v2/teams/team_abc");
    assert.equal(seen!.headers.Authorization, "Bearer vercel-secret-token");
    assert.deepEqual(vercel, { integration: "vercel", ok: true, plan: "pro", account: "my-team", error: null });

    const github = await runProviderCheck("github", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ login: "MuraliKrishna77star", plan: { name: "free", space: 1, private_repos: 1, collaborators: 0 } }),
    }));
    assert.deepEqual(github, { integration: "github", ok: true, plan: "free", account: "MuraliKrishna77star", error: null });

    // Someone else's token reports someone else's plan, which must not show as verified.
    const otherAccount = await runProviderCheck("github", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ login: "someone-else", plan: { name: "pro" } }),
    }));
    assert.equal(otherAccount.ok, false);
    assert.equal(otherAccount.plan, null);
    assert.match(otherAccount.error!, /belongs to someone-else, not the repository owner/);

    const denied = await runProviderCheck("vercel", async () => ({ ok: false, status: 403, json: async () => ({}) }));
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "Vercel API returned HTTP 403 (check the token and its access)");
    const offline = await runProviderCheck("github", async () => {
      throw new TypeError("fetch failed");
    });
    assert.equal(offline.error, "Could not reach GitHub API");
    for (const r of [vercel, github, denied, offline]) assert.doesNotMatch(JSON.stringify(r), /secret-token/);

    const body = JSON.stringify((await call("GET", "/tech-dashboard")).json());
    assert.doesNotMatch(body, /secret-token/);
  } finally {
    config.vercelApiToken = "";
    config.vercelTeamId = "";
    config.githubToken = "";
  }
});

test("verify route: stores what the provider said, apart from the manual record", async () => {
  const realFetch = globalThis.fetch;
  config.vercelApiToken = "vercel-secret-token";
  config.vercelTeamId = "team_abc";
  globalThis.fetch = (async () => new Response(JSON.stringify({ slug: "my-team", billing: { plan: "hobby" } }))) as typeof fetch;
  try {
    await call("PUT", "/tech-dashboard/services/vercel/subscription", superToken, { plan: "Pro", subscription_status: "unknown" });
    const res = await call("POST", "/tech-dashboard/services/vercel/verify", superToken, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().plan, "hobby");
    assert.equal(res.json().ok, true);

    const body = (await call("GET", "/tech-dashboard")).payload;
    assert.doesNotMatch(body, /vercel-secret-token/);
    const dash = JSON.parse(body) as TechDashboard;
    const vercel = dash.services.find((s) => s.id === "vercel")!;
    // The provider's answer never overwrites the manual record, and never sets a status.
    assert.equal(vercel.subscription?.plan, "Pro");
    assert.equal(vercel.subscription?.subscription_status, "unknown");
    assert.equal(vercel.provider_check?.plan, "hobby");
    assert.ok(dash.alerts.some((a) => a.service_id === "vercel" && a.kind === "plan_mismatch"));
    const logged = auditLogsRepo.list({ entityType: "tech_subscription", entityId: "vercel" });
    assert.ok(logged.some((l) => l.action === "verify_tech_subscription" && !l.details?.includes("secret-token")));
  } finally {
    globalThis.fetch = realFetch;
    config.vercelApiToken = "";
    config.vercelTeamId = "";
    await call("DELETE", "/tech-dashboard/services/vercel/subscription");
  }
});

function service(sub: Partial<NonNullable<TechService["subscription"]>> | null, extra: Partial<TechService> = {}): TechService {
  return {
    id: "svc",
    name: "Svc",
    category: "hosting",
    provider: "P",
    cost_model: "managed_service",
    critical: true,
    version: null,
    version_source: null,
    purpose: "",
    used_in: [],
    impact_if_unavailable: "",
    links: [],
    facts: [],
    integration: null,
    billed_with: null,
    can_record: true,
    provider_check: null,
    subscription: sub && {
      plan: null,
      account_owner: null,
      subscription_status: "active",
      billing_status: "unknown",
      billing_frequency: "unknown",
      amount: null,
      currency: null,
      next_payment_date: null,
      renewal_date: null,
      auto_renew: "unknown",
      notes: null,
      updated_by: "boss",
      updated_at: "2026-11-01 00:00:00",
      ...sub,
    },
    ...extra,
  };
}

const kinds = (s: TechService) => serviceAlerts(s, "2026-11-02").map((a) => `${a.severity}:${a.kind}`);

test("alerts come only from recorded dates and statuses", () => {
  assert.deepEqual(kinds(service({ billing_status: "overdue", next_payment_date: "2026-10-20" })), ["critical:overdue_payment"]);
  assert.deepEqual(kinds(service({ billing_status: "paid", next_payment_date: "2026-10-20" })), ["warning:payment_date_passed"]);
  assert.deepEqual(kinds(service({ billing_status: "paid", next_payment_date: "2026-11-10" })), ["info:upcoming_payment"]);
  assert.deepEqual(kinds(service({ billing_status: "paid", next_payment_date: "2026-12-30" })), []);
  assert.deepEqual(kinds(service({ subscription_status: "trial", renewal_date: "2026-11-05" })), ["warning:trial_expiring"]);
  assert.deepEqual(kinds(service({ subscription_status: "trial", renewal_date: "2026-10-30" })), ["critical:trial_ended"]);
  assert.deepEqual(kinds(service({ subscription_status: "active", renewal_date: "2026-11-09", auto_renew: "no" })), ["critical:no_auto_renew"]);
  assert.deepEqual(kinds(service({ subscription_status: "active", renewal_date: "2026-11-09", auto_renew: "unknown" })), ["warning:upcoming_renewal"]);
  assert.deepEqual(kinds(service({ subscription_status: "active", renewal_date: "2026-10-01" })), ["warning:renewal_date_passed"]);
  // A recorded date still matters when the status itself is unknown.
  assert.deepEqual(kinds(service({ subscription_status: "unknown", renewal_date: "2026-11-09", auto_renew: "yes" })), ["info:unrecorded_critical", "info:upcoming_renewal"]);
  assert.deepEqual(kinds(service({ subscription_status: "trial" })), ["warning:trial_no_end_date"]);
  // A due payment whose date has passed is one alert, not two.
  assert.deepEqual(kinds(service({ billing_status: "due", next_payment_date: "2026-10-20" })), ["warning:payment_due"]);
  // A cancelled subscription has no upcoming payments or renewals to chase.
  assert.deepEqual(kinds(service({ subscription_status: "cancelled", billing_status: "paid", next_payment_date: "2026-11-05", renewal_date: "2026-11-05" }, { critical: false })), []);
  assert.deepEqual(kinds(service({ subscription_status: "cancelled" })), ["critical:inactive_critical"]);
  assert.deepEqual(kinds(service({ subscription_status: "cancelled" }, { critical: false })), []);
  // A plan the provider confirmed that disagrees with the manual record.
  assert.deepEqual(
    kinds(service({ plan: "Pro" }, { provider_check: { integration: "vercel", checked_at: "", ok: true, plan: "hobby", account: null, error: null } })),
    ["warning:plan_mismatch"],
  );
});

test("recurring costs: active only, per currency, usage-based counted as an estimate", () => {
  const costs = recurringCosts([
    service({ subscription_status: "active", billing_frequency: "annual", amount: 1200, currency: "INR" }, { id: "a" }),
    service({ subscription_status: "active", billing_frequency: "monthly", amount: 50, currency: "INR" }, { id: "b" }),
    service({ subscription_status: "active", billing_frequency: "quarterly", amount: 30, currency: "USD" }, { id: "c" }),
    service({ subscription_status: "active", billing_frequency: "usage_based", amount: 5, currency: "USD" }, { id: "d" }),
    service({ subscription_status: "active" }, { id: "e" }),
    service({ subscription_status: "cancelled", billing_frequency: "monthly", amount: 99, currency: "USD" }, { id: "f" }),
    service({ subscription_status: "unknown", billing_frequency: "monthly", amount: 99, currency: "USD" }, { id: "g" }),
    service({ subscription_status: "active", billing_frequency: "one_time", amount: 99, currency: "USD" }, { id: "h" }),
    service({ subscription_status: "active", billing_frequency: "none" }, { id: "free-plan" }),
  ]);
  assert.deepEqual(costs.by_currency, [
    { currency: "INR", monthly: 150, annual: 1800, service_count: 2, usage_based_count: 0 },
    { currency: "USD", monthly: 15, annual: 180, service_count: 2, usage_based_count: 1 },
  ]);
  assert.deepEqual(costs.excluded.map((e) => e.service_id), ["e", "h"]);
});
