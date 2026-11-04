import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { config } = await import("../config.js");
const { buildApp } = await import("../app.js");
const { usersRepo } = await import("../repositories/users.js");
const { auditLogsRepo } = await import("../repositories/auditLogs.js");
const { authSessionsRepo } = await import("../repositories/authSessions.js");
const { hashPassword } = await import("../services/auth.js");
const { rotateRefreshToken, createSession } = await import("../services/sessions.js");

config.webAppUrl = "https://web.example.test";
const app = await buildApp();
app.log.level = "silent";
test.after(() => app.close());

const hash = hashPassword("right-password");
for (const [id, role] of [["boss", "super_admin"], ["own", "owner"], ["cash", "operator"], ["cash2", "operator"], ["pump", "field_operator"]] as const) {
  usersRepo.create({ user_id: id, name: id, password_hash: hash, role });
}

const DAY = 24 * 60 * 60 * 1000;
const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0];

async function login(user_id: string, password = "right-password") {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { user_id, password } });
  return { res, token: res.json().token as string, cookie: res.statusCode === 200 ? cookieOf(res) : "" };
}
const get = (url: string, token?: string) => app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const refresh = (cookie: string) => app.inject({ method: "POST", url: "/auth/refresh", headers: { cookie } });
const sessionIdOf = (token: string) => (app.jwt.decode(token) as { sid: string }).sid;
const actions = (entityId: string) => auditLogsRepo.list({ entityId }).map((l) => l.action);

test("password login gives a short-lived token and an HttpOnly refresh cookie", async () => {
  const { res, token } = await login("cash");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().user, { user_id: "cash", name: "cash", role: "operator" });
  const claims = app.jwt.decode(token) as { exp: number; iat: number; sid: string };
  assert.equal(claims.exp - claims.iat, 15 * 60);
  assert.ok(claims.sid);
  assert.equal((await get("/auth/me", token)).json().sub, "cash");
  const cookie = String(res.headers["set-cookie"]);
  for (const attribute of ["HttpOnly", "SameSite=Strict", "Secure", "Path=/session-api"]) assert.match(cookie, new RegExp(attribute));
  // Only a hash is stored, and the response body never carries the refresh token.
  const secret = cookieOf(res).split(".")[1];
  assert.notEqual(authSessionsRepo.get(claims.sid)?.refresh_hash, secret);
  assert.doesNotMatch(res.body, new RegExp(secret));
  assert.ok(actions("cash").includes("login"));
});

test("wrong password and unknown user are refused the same way, and recorded", async () => {
  const wrong = await login("cash", "wrong-password");
  const unknown = await login("nobody", "wrong-password");
  assert.equal(wrong.res.statusCode, 401);
  assert.equal(unknown.res.statusCode, 401);
  assert.equal(wrong.res.json().error, unknown.res.json().error);
  assert.equal(wrong.res.headers["set-cookie"], undefined);
  assert.ok(actions("cash").includes("login_failed"));
  // What was typed for a user that doesn't exist isn't kept: it could be a mistyped password.
  assert.doesNotMatch(JSON.stringify(auditLogsRepo.list()), /nobody|wrong-password/);
});

test("tokens from before sessions existed, and forged ones, are refused", async () => {
  const legacy = app.jwt.sign({ sub: "boss", role: "super_admin", name: "boss" } as never);
  assert.equal((await get("/users", legacy)).statusCode, 401);
  assert.equal((await get("/auth/me", legacy)).statusCode, 401);
  const madeUpSession = app.signAccessToken({ user_id: "boss", role: "super_admin", name: "boss" }, "no-such-session");
  assert.equal((await get("/users", madeUpSession)).statusCode, 401);
  // A real session belonging to someone else doesn't help either.
  const { token } = await login("cash");
  const borrowed = app.signAccessToken({ user_id: "boss", role: "super_admin", name: "boss" }, sessionIdOf(token));
  assert.equal((await get("/users", borrowed)).statusCode, 401);
});

test("customer and QR tokens stay out of staff routes", async () => {
  assert.equal((await get("/auth/me", app.jwt.sign({ sub: "C1", role: "customer", name: "C" }))).statusCode, 403);
  assert.equal((await get("/users", app.jwt.sign({ sub: "1", role: "invoice" }))).statusCode, 403);
});

test("an expired access token is refused, and the refresh cookie renews it", async () => {
  const saved = config.accessTokenTtlSeconds;
  config.accessTokenTtlSeconds = 1;
  try {
    const { token, cookie } = await login("cash");
    assert.equal((await get("/auth/me", token)).statusCode, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await get("/auth/me", token)).statusCode, 401);
    const renewed = await refresh(cookie);
    assert.equal(renewed.statusCode, 200);
    assert.equal((await get("/auth/me", renewed.json().token)).statusCode, 200);
    assert.equal(sessionIdOf(renewed.json().token), sessionIdOf(token));
  } finally {
    config.accessTokenTtlSeconds = saved;
  }
});

test("a session ends after going idle, and at its absolute limit, however active", async () => {
  for (const [column, age] of [["last_used_at", (config.sessionIdleDays + 1) * DAY], ["expires_at", 1000]] as const) {
    const { token, cookie } = await login("cash");
    const sid = sessionIdOf(token);
    const value = column === "last_used_at" ? Date.now() - age : Date.now() - 1;
    db.prepare(`UPDATE auth_sessions SET ${column} = ? WHERE id = ?`).run(value, sid);
    const res = await refresh(cookie);
    assert.equal(res.statusCode, 401, column);
    assert.match(String(res.headers["set-cookie"]), /Max-Age=0/);
    assert.equal(authSessionsRepo.get(sid)?.revoke_reason, "expired");
    assert.equal((await get("/auth/me", token)).statusCode, 401);
  }
});

test("an unexpired access token stops working as soon as its session passes its limit", async () => {
  const { token } = await login("cash");
  assert.equal((await get("/auth/me", token)).statusCode, 200);
  db.prepare("UPDATE auth_sessions SET expires_at = ? WHERE id = ?").run(Date.now() - 1, sessionIdOf(token));
  assert.equal((await get("/auth/me", token)).statusCode, 401);
});

test("simultaneous sessions are independent: signing out one leaves the other", async () => {
  const phone = await login("cash");
  const desk = await login("cash");
  assert.notEqual(sessionIdOf(phone.token), sessionIdOf(desk.token));
  assert.equal((await get("/auth/me", phone.token)).statusCode, 200);
  assert.equal((await get("/auth/me", desk.token)).statusCode, 200);

  const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: phone.cookie } });
  assert.equal(out.statusCode, 200);
  assert.match(String(out.headers["set-cookie"]), /Max-Age=0/);
  assert.equal((await get("/auth/me", phone.token)).statusCode, 401);
  assert.equal((await refresh(phone.cookie)).statusCode, 401);
  assert.equal((await get("/auth/me", desk.token)).statusCode, 200);
  assert.equal((await refresh(desk.cookie)).statusCode, 200);
  assert.ok(actions("cash").includes("logout"));
});

test("deactivating a user ends every session at once, on the backend", async () => {
  const a = await login("cash2");
  const b = await login("cash2");
  const { token: boss } = await login("boss");
  const res = await app.inject({ method: "POST", url: "/users/cash2/deactivate", headers: { authorization: `Bearer ${boss}` }, payload: {} });
  assert.equal(res.statusCode, 200);

  // Both tokens were valid for minutes more, and now aren't: on read routes and write routes.
  for (const session of [a, b]) {
    assert.equal((await get("/auth/me", session.token)).statusCode, 401);
    assert.equal((await get("/items", session.token)).statusCode, 401);
    const bill = await app.inject({ method: "POST", url: "/bills", headers: { authorization: `Bearer ${session.token}` }, payload: { paymentType: "cash", lines: [] } });
    assert.equal(bill.statusCode, 401);
    assert.equal((await refresh(session.cookie)).statusCode, 401);
  }
  assert.equal((await login("cash2")).res.statusCode, 401);
  const logged = actions("cash2");
  assert.ok(logged.includes("deactivate_user"));
  assert.ok(logged.includes("sessions_revoked"));
  assert.ok(logged.includes("login_denied"));
  const revoked = auditLogsRepo.list({ entityId: "cash2" }).find((l) => l.action === "sessions_revoked")!;
  assert.deepEqual(JSON.parse(revoked.details!), { reason: "user_deactivated", count: 2 });

  // Reactivating lets them sign in again, and doesn't bring the old sessions back.
  await app.inject({ method: "POST", url: "/users/cash2/reactivate", headers: { authorization: `Bearer ${boss}` }, payload: {} });
  assert.equal((await get("/auth/me", a.token)).statusCode, 401);
  assert.equal((await login("cash2")).res.statusCode, 200);
});

test("a user made inactive some other way is still refused", async () => {
  const { token, cookie } = await login("pump");
  usersRepo.setActive("pump", false);
  assert.equal((await get("/auth/me", token)).statusCode, 401);
  assert.equal((await refresh(cookie)).statusCode, 401);
  usersRepo.setActive("pump", true);
});

test("resetting a password ends the user's sessions", async () => {
  const { token: boss } = await login("boss");
  const victim = await login("pump");
  const res = await app.inject({ method: "POST", url: "/users/pump/reset-password", headers: { authorization: `Bearer ${boss}` }, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal((await get("/auth/me", victim.token)).statusCode, 401);
  usersRepo.setPasswordHash("pump", hash);
});

test("a role change applies from the next request, not when the token expires", async () => {
  const { token } = await login("own");
  assert.equal((await get("/purchases", token)).statusCode, 200);
  usersRepo.update("own", { name: "own", role: "field_operator" });
  assert.equal((await get("/purchases", token)).statusCode, 403);
  assert.equal((await get("/auth/me", token)).json().role, "field_operator");
  usersRepo.update("own", { name: "own", role: "owner" });
});

test("refresh tokens rotate; a tab race is forgiven; a stolen old token ends the session", async () => {
  const start = Date.now();
  const { refreshToken: r1, sessionId } = createSession("cash", "password", undefined, start);

  const first = rotateRefreshToken(r1, start + 1000);
  assert.equal(first.status, "ok");
  const r2 = first.status === "ok" ? first.refreshToken : "";
  assert.notEqual(r2, r1);

  // A second tab, or a reply lost in transit: the previous token works just after rotation.
  const raced = rotateRefreshToken(r1, start + 2000);
  assert.equal(raced.status, "ok");
  // A third tab with a token now two generations old is told to wait, not punished.
  assert.equal(rotateRefreshToken(r1, start + 3000).status, "retry");
  assert.equal(authSessionsRepo.get(sessionId)?.revoked_at, null);

  // Long after, that same old token can only be a copy.
  const late = rotateRefreshToken(r1, start + 10 * 60 * 1000);
  assert.equal(late.status, "ended");
  assert.deepEqual(late.status === "ended" ? late.reuseDetected : null, { sessionId, userId: "cash" });
  assert.equal(authSessionsRepo.get(sessionId)?.revoke_reason, "refresh_token_reuse");
  // And the newest token dies with it.
  assert.equal(rotateRefreshToken(raced.status === "ok" ? raced.refreshToken : "", start + 10 * 60 * 1000 + 1).status, "ended");
});

test("refresh refuses missing and malformed cookies", async () => {
  for (const cookie of ["", "petropro_refresh=", "petropro_refresh=nodot", "petropro_refresh=no-such.session"]) {
    assert.equal((await refresh(cookie)).statusCode, 401, cookie);
  }
});

test("existing data is untouched: the user's id and role survive login and logout", async () => {
  const before = usersRepo.getById("cash");
  const { cookie } = await login("cash");
  await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
  assert.deepEqual(usersRepo.getById("cash"), before);
});
