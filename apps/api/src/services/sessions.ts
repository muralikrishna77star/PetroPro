import crypto from "node:crypto";
import { config } from "../config.js";
import { authSessionsRepo } from "../repositories/authSessions.js";
import { usersRepo, type User } from "../repositories/users.js";

export const REFRESH_COOKIE = "petropro_refresh";
// The browser reaches these routes through the web app's own origin (next.config.ts), which is
// what makes this a first-party cookie even though the API lives on another domain.
const REFRESH_COOKIE_PATH = "/session-api";
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long the token before the current one still works, for tabs racing and replies lost in transit. */
const ROTATION_GRACE_MS = 2 * 60 * 1000;

const hashToken = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");
const newSecret = () => crypto.randomBytes(32).toString("base64url");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function cookieAttributes(maxAgeSeconds: number): string {
  const secure = config.webAppUrl.startsWith("https://") ? "; Secure" : "";
  return `HttpOnly; SameSite=Strict; Path=${REFRESH_COOKIE_PATH}; Max-Age=${maxAgeSeconds}${secure}`;
}

export function refreshCookie(refreshToken: string): string {
  return `${REFRESH_COOKIE}=${refreshToken}; ${cookieAttributes(config.sessionAbsoluteDays * 24 * 60 * 60)}`;
}

export function clearedRefreshCookie(): string {
  return `${REFRESH_COOKIE}=; ${cookieAttributes(0)}`;
}

export function createSession(userId: string, loginMethod: "password" | "google", userAgent: string | undefined, now = Date.now()) {
  const id = crypto.randomUUID();
  const secret = newSecret();
  authSessionsRepo.prune(now - 30 * DAY_MS);
  authSessionsRepo.create(
    {
      id,
      user_id: userId,
      refresh_hash: hashToken(secret),
      login_method: loginMethod,
      user_agent: userAgent?.slice(0, 200) ?? null,
      expires_at: now + config.sessionAbsoluteDays * DAY_MS,
    },
    now,
  );
  return { sessionId: id, refreshToken: `${id}.${secret}` };
}

export type RefreshResult =
  | { status: "ok"; user: User; sessionId: string; refreshToken: string }
  /** Probably another tab mid-rotation: the cookie will have moved on, so try again shortly. */
  | { status: "retry" }
  | { status: "ended"; reuseDetected?: { sessionId: string; userId: string } };

/**
 * Swaps a refresh token for a new one (rotation). The token just replaced keeps working for a
 * couple of minutes, because two tabs can race and a phone can lose the reply. Anything older
 * being presented later means a copy of a token is in use somewhere, so the session is ended.
 */
export function rotateRefreshToken(refreshToken: string | undefined, now = Date.now()): RefreshResult {
  const [id, secret] = (refreshToken ?? "").split(".");
  const session = id ? authSessionsRepo.get(id) : undefined;
  if (!session || !secret || session.revoked_at !== null) return { status: "ended" };

  if (now >= session.expires_at || now - session.last_used_at >= config.sessionIdleDays * DAY_MS) {
    authSessionsRepo.revoke(session.id, "expired", now);
    return { status: "ended" };
  }
  const user = usersRepo.getById(session.user_id);
  if (!user || !user.active) {
    authSessionsRepo.revoke(session.id, "user_inactive", now);
    return { status: "ended" };
  }

  const presented = hashToken(secret);
  const withinGrace = now - session.rotated_at < ROTATION_GRACE_MS;
  const isCurrent = safeEqual(presented, session.refresh_hash);
  const isPrevious = session.previous_hash !== null && safeEqual(presented, session.previous_hash) && withinGrace;
  if (!isCurrent && !isPrevious) {
    if (withinGrace) return { status: "retry" };
    authSessionsRepo.revoke(session.id, "refresh_token_reuse", now);
    return { status: "ended", reuseDetected: { sessionId: session.id, userId: session.user_id } };
  }

  const next = newSecret();
  authSessionsRepo.rotate(session.id, hashToken(next), session.refresh_hash, now);
  return { status: "ok", user, sessionId: session.id, refreshToken: `${session.id}.${next}` };
}

/** The session a refresh token belongs to, if the token really is that session's. */
export function sessionForRefreshToken(refreshToken: string | undefined) {
  const [id, secret] = (refreshToken ?? "").split(".");
  const session = id ? authSessionsRepo.get(id) : undefined;
  if (!session || !secret) return undefined;
  const presented = hashToken(secret);
  const matches = safeEqual(presented, session.refresh_hash) || (session.previous_hash !== null && safeEqual(presented, session.previous_hash));
  return matches ? session : undefined;
}
