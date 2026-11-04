import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { config } = await import("../config.js");
const { buildApp } = await import("../app.js");
const { usersRepo } = await import("../repositories/users.js");
const { auditLogsRepo } = await import("../repositories/auditLogs.js");
const { hashPassword } = await import("../services/auth.js");
const { createSession } = await import("../services/sessions.js");

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const CERTS_URL = "https://keys.example.test/certs";

config.googleClientId = CLIENT_ID;
config.googleClientSecret = "test-client-secret";
config.googleRedirectUri = "https://api.example.test/auth/google/callback";
config.webAppUrl = "https://web.example.test";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const attacker = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };

// A stand-in for Google's servers: what the token endpoint answers next, and what it was asked.
let nextIdToken: string | null = null;
let tokenRequests: URLSearchParams[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ jwks_uri: CERTS_URL });
  if (url === CERTS_URL) return Response.json({ keys: [publicJwk] });
  if (url === "https://oauth2.googleapis.com/token") {
    tokenRequests.push(new URLSearchParams(String(init?.body)));
    if (!nextIdToken) return new Response("{}", { status: 400 });
    return Response.json({ id_token: nextIdToken, access_token: "access-token-not-used" });
  }
  throw new Error(`Unexpected request to ${url}`);
}) as typeof fetch;

const app = await buildApp();
app.log.level = "silent";
test.after(async () => {
  await app.close();
  globalThis.fetch = realFetch;
});

const PASSWORD = "the-real-password";
const hash = hashPassword(PASSWORD);
const addUser = (id: string, role: "super_admin" | "owner" | "operator", email?: string) =>
  usersRepo.create({ user_id: id, name: id, password_hash: hash, role, email });
addUser("boss", "super_admin");
addUser("own", "owner");
addUser("cash1", "operator", "cash1@example.com");
addUser("gone", "operator", "gone@example.com");
usersRepo.setActive("gone", false);
addUser("pair", "operator", "pair@example.com");
addUser("lock", "operator", "lock@example.com");

const superToken = app.signAccessToken({ user_id: "boss", role: "super_admin", name: "boss" }, createSession("boss", "password", undefined).sessionId);
const ownerToken = app.signAccessToken({ user_id: "own", role: "owner", name: "own" }, createSession("own", "password", undefined).sessionId);

const userCount = () => (db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;

/** Runs GET /auth/google like a browser, returning its cookie and what it would send to Google. */
async function start() {
  const res = await app.inject({ method: "GET", url: "/auth/google" });
  assert.equal(res.statusCode, 302);
  const location = new URL(res.headers.location as string);
  return {
    res,
    location,
    cookie: String(res.headers["set-cookie"]).split(";")[0],
    state: location.searchParams.get("state")!,
    nonce: location.searchParams.get("nonce")!,
  };
}

function idToken(claims: Record<string, unknown>, opts: { key?: Parameters<SignJWT["sign"]>[0]; audience?: string; issuer?: string; expires?: string | number } = {}) {
  return new SignJWT({ email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.issuer ?? "https://accounts.google.com")
    .setAudience(opts.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(opts.expires ?? "1h")
    .sign(opts.key ?? privateKey);
}

/** A full trip to Google. `claims` and `opts` shape the token "Google" returns; returns the final redirect. */
async function viaGoogle(claims: Record<string, unknown>, opts: Parameters<typeof idToken>[1] & { badNonce?: boolean } = {}) {
  const flow = await start();
  nextIdToken = await idToken({ nonce: opts.badNonce ? "someone-elses-nonce" : flow.nonce, ...claims }, opts);
  const res = await app.inject({
    method: "GET",
    url: `/auth/google/callback?code=the-code&state=${flow.state}`,
    headers: { cookie: flow.cookie },
  });
  assert.equal(res.statusCode, 302);
  return new URL(res.headers.location as string);
}

const errorOf = (url: URL) => url.searchParams.get("error");
const fragmentOf = (url: URL) => new URLSearchParams(url.hash.slice(1));
const linkWith = (ticket: string, password: string) => app.inject({ method: "POST", url: "/auth/google/link", payload: { ticket, password } });
const exchange = (ticket: string | null) => app.inject({ method: "POST", url: "/auth/google/exchange", payload: { ticket } });

/** First-time link: Google, then the right password. */
async function link(sub: string, email: string) {
  const ticket = fragmentOf(await viaGoogle({ sub, email })).get("link")!;
  assert.ok(ticket, "expected a password step");
  const res = await linkWith(ticket, PASSWORD);
  assert.equal(res.statusCode, 200, res.body);
  return res;
}
/** Returning user: Google, then the seamless hand-over. Returns the session response. */
async function returning(sub: string, email: string) {
  return exchange(fragmentOf(await viaGoogle({ sub, email })).get("handoff"));
}

test("start: sends PKCE, state and nonce, and binds them to an HttpOnly cookie", async () => {
  const { res, location, state, nonce } = await start();
  assert.equal(location.origin + location.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.ok(location.searchParams.get("code_challenge"));
  assert.ok(state && nonce && state !== nonce);
  const cookie = String(res.headers["set-cookie"]);
  for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/auth/google"]) assert.match(cookie, new RegExp(attribute));
  assert.doesNotMatch(location.href, /test-client-secret/);
});

test("the verifier sent to Google hashes to the challenge sent at the start", async () => {
  const flow = await start();
  nextIdToken = await idToken({ nonce: flow.nonce, sub: "google-pkce", email: "stranger-pkce@example.com" });
  tokenRequests = [];
  await app.inject({ method: "GET", url: `/auth/google/callback?code=c&state=${flow.state}`, headers: { cookie: flow.cookie } });
  const verifier = tokenRequests[0].get("code_verifier")!;
  assert.equal(crypto.createHash("sha256").update(verifier).digest("base64url"), flow.location.searchParams.get("code_challenge"));
  assert.notEqual(verifier, flow.location.searchParams.get("code_challenge"));
});

test("a matching email alone neither signs in nor links: the password step is required", async () => {
  const before = userCount();
  const url = await viaGoogle({ sub: "google-1", email: "CASH1@example.com" });
  assert.equal(url.origin + url.pathname, "https://web.example.test/login/callback");
  const fragment = fragmentOf(url);
  assert.ok(fragment.get("link"));
  assert.equal(fragment.get("email"), "cash1@example.com");
  assert.equal(fragment.get("handoff"), null);
  assert.doesNotMatch(url.href, /eyJ/); // no session in the URL
  assert.equal(usersRepo.getById("cash1")?.google_sub, null);
  assert.equal(userCount(), before);
  // The ticket can't be used to skip the password.
  assert.equal((await exchange(fragment.get("link"))).statusCode, 400);
  assert.equal(usersRepo.getById("cash1")?.google_sub, null);
});

test("an incorrect password doesn't link, and is recorded", async () => {
  const ticket = fragmentOf(await viaGoogle({ sub: "google-1", email: "cash1@example.com" })).get("link")!;
  const wrong = await linkWith(ticket, "not-the-password");
  assert.equal(wrong.statusCode, 401);
  assert.match(wrong.json().error, /Incorrect password/);
  assert.equal(wrong.headers["set-cookie"], undefined);
  assert.equal(usersRepo.getById("cash1")?.google_sub, null);
  assert.ok(auditLogsRepo.list({ entityId: "cash1" }).some((l) => l.action === "google_link_denied" && l.details?.includes("incorrect_password")));
  assert.doesNotMatch(JSON.stringify(auditLogsRepo.list()), /not-the-password/);
});

test("the right password links, keeps the user's identity, and creates no one", async () => {
  const before = userCount();
  const beforeUser = usersRepo.getById("cash1")!;
  const res = await link("google-1", "cash1@example.com");

  const after = usersRepo.getById("cash1")!;
  assert.equal(after.google_sub, "google-1");
  assert.deepEqual({ ...after, google_sub: null }, { ...beforeUser }); // nothing else about the user changed
  assert.equal(userCount(), before);
  assert.deepEqual(res.json().user, { user_id: "cash1", name: "cash1", role: "operator" });
  assert.match(String(res.headers["set-cookie"]), /petropro_refresh=.*HttpOnly/);
  const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${res.json().token}` } });
  assert.equal(me.json().sub, "cash1");
  const logged = auditLogsRepo.list({ entityId: "cash1" }).map((l) => l.action);
  assert.ok(logged.includes("google_account_linked"));
  assert.ok(logged.includes("login"));
});

test("a link ticket can't be replayed", async () => {
  const ticket = fragmentOf(await viaGoogle({ sub: "google-pair", email: "pair@example.com" })).get("link")!;
  assert.equal((await linkWith(ticket, PASSWORD)).statusCode, 200);
  assert.equal((await linkWith(ticket, PASSWORD)).statusCode, 400);
  usersRepo.unlinkGoogle("pair");
});

test("expired tickets are refused", async () => {
  const ticket = fragmentOf(await viaGoogle({ sub: "google-pair", email: "pair@example.com" })).get("link")!;
  db.prepare("UPDATE google_tickets SET expires_at = ?").run(Date.now() - 1);
  assert.equal((await linkWith(ticket, PASSWORD)).statusCode, 400);
  assert.equal(usersRepo.getById("pair")?.google_sub, null);
});

test("subsequent sign-ins need no password, and sub decides even if the Google email changed", async () => {
  const res = await returning("google-1", "cash1@example.com");
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.user_id, "cash1");
  const renamed = await returning("google-1", "new-address@example.com");
  assert.equal(renamed.json().user.user_id, "cash1");
  assert.ok(auditLogsRepo.list({ entityId: "cash1" }).some((l) => l.action === "login" && l.details?.includes('"method":"google"')));

  // A hand-over ticket works once.
  const ticket = fragmentOf(await viaGoogle({ sub: "google-1", email: "cash1@example.com" })).get("handoff");
  assert.equal((await exchange(ticket)).statusCode, 200);
  assert.equal((await exchange(ticket)).statusCode, 400);
});

test("a different Google account can't take over a linked user, even with the same email", async () => {
  const url = await viaGoogle({ sub: "google-someone-else", email: "cash1@example.com" });
  assert.equal(errorOf(url), "account_conflict");
  assert.equal(usersRepo.getById("cash1")?.google_sub, "google-1");
});

test("incorrect email: an unknown Google account is refused, and nothing is created", async () => {
  const before = userCount();
  const url = await viaGoogle({ sub: "google-stranger", email: "stranger@example.com" });
  assert.equal(errorOf(url), "not_registered");
  assert.equal(userCount(), before);
  assert.equal(usersRepo.getByGoogleSub("google-stranger"), undefined);
  assert.ok(auditLogsRepo.list().some((l) => l.action === "google_login_denied" && l.details?.includes("stranger@example.com")));
});

test("duplicate accounts: one Google identity can't reach a second user", async () => {
  addUser("dup", "operator", "dup@example.com");
  // Its email now points at dup, but the identity already belongs to cash1, so sub decides.
  const res = await returning("google-1", "dup@example.com");
  assert.equal(res.json().user.user_id, "cash1");
  assert.equal(usersRepo.getById("dup")?.google_sub, null);

  // Two tickets started before either finished: the second to finish loses to the unique link.
  const a = fragmentOf(await viaGoogle({ sub: "google-race", email: "dup@example.com" })).get("link")!;
  const b = fragmentOf(await viaGoogle({ sub: "google-race", email: "pair@example.com" })).get("link")!;
  assert.equal((await linkWith(a, PASSWORD)).statusCode, 200);
  assert.equal((await linkWith(b, PASSWORD)).statusCode, 409);
  assert.equal(usersRepo.getById("pair")?.google_sub, null);

  // And the unique index holds even if the check above were bypassed.
  assert.equal(usersRepo.linkGoogle("pair", "google-race"), undefined);
  assert.equal(usersRepo.getById("pair")?.google_sub, null);
  // Same user with two tickets for two Google accounts: first wins.
  const c = fragmentOf(await viaGoogle({ sub: "google-c1", email: "pair@example.com" })).get("link")!;
  const d = fragmentOf(await viaGoogle({ sub: "google-c2", email: "pair@example.com" })).get("link")!;
  assert.equal((await linkWith(c, PASSWORD)).statusCode, 200);
  assert.equal((await linkWith(d, PASSWORD)).statusCode, 409);
  assert.equal(usersRepo.getById("pair")?.google_sub, "google-c1");
  usersRepo.unlinkGoogle("pair");
});

test("a deactivated user can't sign in, link, or finish a sign-in already under way", async () => {
  assert.equal(errorOf(await viaGoogle({ sub: "google-gone", email: "gone@example.com" })), "account_inactive");
  assert.equal(usersRepo.getById("gone")?.google_sub, null);

  // Deactivated while on the password screen.
  const ticket = fragmentOf(await viaGoogle({ sub: "google-pair", email: "pair@example.com" })).get("link")!;
  usersRepo.setActive("pair", false);
  assert.equal((await linkWith(ticket, PASSWORD)).statusCode, 401);
  assert.equal(usersRepo.getById("pair")?.google_sub, null);
  usersRepo.setActive("pair", true);

  // Linked, then deactivated.
  assert.equal((await linkWith(ticket, PASSWORD)).statusCode, 200);
  usersRepo.setActive("pair", false);
  assert.equal(errorOf(await viaGoogle({ sub: "google-pair", email: "pair@example.com" })), "account_inactive");
  // Deactivated between Google's answer and the hand-over.
  usersRepo.setActive("pair", true);
  const handoff = fragmentOf(await viaGoogle({ sub: "google-pair", email: "pair@example.com" })).get("handoff");
  usersRepo.setActive("pair", false);
  assert.equal((await exchange(handoff)).statusCode, 401);
  usersRepo.setActive("pair", true);
  usersRepo.unlinkGoogle("pair");
});

test("repeated wrong passwords lock the link step, even across new tickets", async () => {
  for (let i = 0; i < 5; i++) {
    const ticket = fragmentOf(await viaGoogle({ sub: "google-lock", email: "lock@example.com" })).get("link")!;
    assert.equal((await linkWith(ticket, "wrong")).statusCode, 401);
  }
  const ticket = fragmentOf(await viaGoogle({ sub: "google-lock", email: "lock@example.com" })).get("link")!;
  const locked = await linkWith(ticket, PASSWORD); // even the right one
  assert.equal(locked.statusCode, 429);
  assert.equal(usersRepo.getById("lock")?.google_sub, null);
  // The lock passes with time.
  db.prepare("UPDATE google_tickets SET created_at = created_at - ? WHERE user_id = 'lock'").run(16 * 60 * 1000);
  const later = fragmentOf(await viaGoogle({ sub: "google-lock", email: "lock@example.com" })).get("link")!;
  assert.equal((await linkWith(later, PASSWORD)).statusCode, 200);
});

test("an unverified email never signs in or links", async () => {
  for (const claims of [{ email_verified: false }, { email_verified: "true" }, { email_verified: undefined }]) {
    const url = await viaGoogle({ sub: "google-unverified", email: "pair@example.com", ...claims });
    assert.equal(errorOf(url), "email_unverified", JSON.stringify(claims));
  }
  assert.equal(usersRepo.getByGoogleSub("google-unverified"), undefined);
});

test("forged or wrong tokens are refused", async () => {
  const cases: [string, Parameters<typeof viaGoogle>[1]][] = [
    ["signed by another key", { key: attacker.privateKey }],
    ["for another app", { audience: "someone-elses-client" }],
    ["from another issuer", { issuer: "https://accounts.evil.example" }],
    ["expired", { expires: Math.floor(Date.now() / 1000) - 60 }],
    ["from another sign-in (nonce)", { badNonce: true }],
  ];
  for (const [name, opts] of cases) {
    const url = await viaGoogle({ sub: "google-forged", email: "pair@example.com" }, opts);
    assert.equal(errorOf(url), "google_failed", name);
  }
  // Both issuer spellings Google documents are genuine.
  const url = await viaGoogle({ sub: "google-pair", email: "pair@example.com" }, { issuer: "accounts.google.com" });
  assert.ok(fragmentOf(url).get("link"));
});

test("a callback not started by this browser never reaches Google", async () => {
  const flow = await start();
  const tampered = flow.cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  tokenRequests = [];
  for (const [name, url, headers] of [
    ["no cookie (login CSRF)", `/auth/google/callback?code=c&state=${flow.state}`, {}],
    ["wrong state", "/auth/google/callback?code=c&state=wrong", { cookie: flow.cookie }],
    ["no state", "/auth/google/callback?code=c", { cookie: flow.cookie }],
    ["tampered cookie", `/auth/google/callback?code=c&state=${flow.state}`, { cookie: tampered }],
  ] as const) {
    const res = await app.inject({ method: "GET", url, headers });
    assert.equal(new URL(res.headers.location as string).searchParams.get("error"), "google_failed", name);
  }
  assert.equal(tokenRequests.length, 0);

  const cancelled = await app.inject({
    method: "GET",
    url: `/auth/google/callback?error=access_denied&state=${flow.state}`,
    headers: { cookie: flow.cookie },
  });
  assert.equal(new URL(cancelled.headers.location as string).searchParams.get("error"), "google_cancelled");
  assert.match(String(cancelled.headers["set-cookie"]), /Max-Age=0/);
});

test("Google refusing the code is reported as a failure", async () => {
  const flow = await start();
  nextIdToken = null;
  const res = await app.inject({
    method: "GET",
    url: `/auth/google/callback?code=used&state=${flow.state}`,
    headers: { cookie: flow.cookie },
  });
  assert.equal(new URL(res.headers.location as string).searchParams.get("error"), "google_failed");
});

test("not configured: both routes answer 501", async () => {
  const saved = config.googleClientId;
  config.googleClientId = "";
  try {
    assert.equal((await app.inject({ method: "GET", url: "/auth/google" })).statusCode, 501);
    assert.equal((await app.inject({ method: "GET", url: "/auth/google/callback" })).statusCode, 501);
  } finally {
    config.googleClientId = saved;
  }
});

test("admin: the link shows as a flag only, changing the email drops it, and unlinking is super admin only", async () => {
  const call = (method: "GET" | "PUT" | "DELETE", url: string, token: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });

  const listed = (await call("GET", "/users", superToken)).json() as { user_id: string; google_linked: number; google_sub?: string; password_hash?: string }[];
  const cash1 = listed.find((u) => u.user_id === "cash1")!;
  assert.equal(cash1.google_linked, 1);
  assert.equal(cash1.google_sub, undefined);
  assert.doesNotMatch(JSON.stringify(listed), /google-1|\$2[aby]\$/);

  assert.equal((await call("DELETE", "/users/cash1/google-link", ownerToken)).statusCode, 403);
  assert.equal((await app.inject({ method: "DELETE", url: "/users/cash1/google-link" })).statusCode, 401);

  // Saving the same email keeps the link. The response never carries the Google id.
  const same = await call("PUT", "/users/cash1", superToken, { name: "cash1", role: "operator", email: "cash1@example.com" });
  assert.equal(same.json().google_linked, 1);
  assert.equal(same.json().google_sub, undefined);

  // A new email means the old Google account must lose access.
  const moved = await call("PUT", "/users/cash1", superToken, { name: "cash1", role: "operator", email: "cash2@example.com" });
  assert.equal(moved.json().google_linked, 0);
  assert.equal(errorOf(await viaGoogle({ sub: "google-1", email: "cash1@example.com" })), "not_registered");
  assert.ok(auditLogsRepo.list({ entityId: "cash1" }).some((l) => l.action === "unlink_google"));

  // The authorized recovery: an admin unlinks, then a replacement Google account links with the password.
  await link("google-old-phone", "cash2@example.com");
  assert.equal((await call("DELETE", "/users/cash1/google-link", superToken)).statusCode, 200);
  assert.equal((await call("DELETE", "/users/cash1/google-link", superToken)).statusCode, 404);
  await link("google-new-phone", "cash2@example.com");
  assert.equal(usersRepo.getById("cash1")?.google_sub, "google-new-phone");
});

test("password login is untouched for a user with a Google link", async () => {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { user_id: "cash1", password: PASSWORD } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.user_id, "cash1");
});
