import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config.js";
import { usersRepo, type User } from "../repositories/users.js";
import { readCookie } from "./sessions.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const FLOW_COOKIE = "petropro_google_flow";
const FLOW_COOKIE_PATH = "/auth/google";
const FLOW_TTL_MS = 5 * 60 * 1000;

/** What ties one sign-in attempt to the browser that started it. */
interface Flow {
  audience?: "staff" | "customer";
  state: string;
  nonce: string;
  verifier: string;
  expires: number;
}

const randomToken = () => crypto.randomBytes(32).toString("base64url");

function signFlow(payload: string): string {
  // Domain-separated, so this signature can't be passed off as anything else signed with jwtSecret.
  return crypto.createHmac("sha256", `google-oauth-flow:${config.jwtSecret}`).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cookieAttributes(maxAgeSeconds: number): string {
  // The whole round trip is top-level navigation against this API's origin, so Lax is sent on
  // the way back from Google. Secure is off only for local http development and the desktop kiosk.
  const secure = config.googleRedirectUri.startsWith("https://") ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax; Path=${FLOW_COOKIE_PATH}; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearedFlowCookie(): string {
  return `${FLOW_COOKIE}=; ${cookieAttributes(0)}`;
}

/** Starts a sign-in: the authorization URL to redirect to, and the cookie binding it to this browser. */
export function startFlow(audience: "staff" | "customer" = "staff"): { authUrl: string; cookie: string } {
  const flow: Flow = { audience, state: randomToken(), nonce: randomToken(), verifier: randomToken(), expires: Date.now() + FLOW_TTL_MS };
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: "code",
    scope: "openid email",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: crypto.createHash("sha256").update(flow.verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return {
    authUrl: `${AUTH_URL}?${params}`,
    cookie: `${FLOW_COOKIE}=${payload}.${signFlow(payload)}; ${cookieAttributes(FLOW_TTL_MS / 1000)}`,
  };
}

/** The flow this browser started, if the callback's `state` belongs to it and it hasn't expired. */
export function readFlow(cookieHeader: string | undefined, state: string | undefined): Flow | null {
  if (!cookieHeader || !state) return null;
  const raw = readCookie(cookieHeader, FLOW_COOKIE);
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !safeEqual(signature, signFlow(payload))) return null;
  try {
    const flow = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Flow;
    return Date.now() < flow.expires && safeEqual(flow.state, state) ? flow : null;
  } catch {
    return null;
  }
}

/** Exchanges the one-time code for Google's ID token. Any access token in the response is ignored. */
export async function exchangeCode(code: string, verifier: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google token endpoint returned HTTP ${res.status}`);
  const body = (await res.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") throw new Error("Google token response had no id_token");
  return body.id_token;
}

let googleKeys: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Google's published signing keys, located through its discovery document as its docs direct. jose caches the keys. */
async function getGoogleKeys() {
  if (!googleKeys) {
    const res = await fetch(DISCOVERY_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Google discovery returned HTTP ${res.status}`);
    const { jwks_uri: jwksUri } = (await res.json()) as { jwks_uri?: unknown };
    if (typeof jwksUri !== "string") throw new Error("Google discovery document had no jwks_uri");
    googleKeys = createRemoteJWKSet(new URL(jwksUri));
  }
  return googleKeys;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
}

/** The token was valid, but Google doesn't vouch for the email address on it. */
export class UnverifiedEmailError extends Error {}

/** Validates signature, issuer, audience, expiry and nonce, then returns who Google says this is. Throws otherwise. */
export async function verifyIdToken(idToken: string, nonce: string): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, await getGoogleKeys(), {
    issuer: ISSUERS,
    audience: config.googleClientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "nonce"],
  });
  if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, nonce)) {
    throw new Error("ID token nonce does not match this sign-in");
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("ID token has no subject");
  if (payload.email_verified !== true || typeof payload.email !== "string") {
    throw new UnverifiedEmailError("Google has not verified this account's email");
  }
  return { sub: payload.sub, email: payload.email.trim().toLowerCase() };
}

export type GoogleDenial = "not_registered" | "account_inactive" | "account_conflict";

export type GoogleResolution = { user: User } | { user: User; linkRequired: true } | { denied: GoogleDenial };

/**
 * Finds the existing PetroPro user for a verified Google identity. Never creates or links one.
 *   1. Already linked: `sub` decides, because Google says an email can change hands and sub can't.
 *   2. Not linked yet: a verified email matching one an admin put on a user makes them the
 *      candidate, and routes/googleAuth.ts then requires that user's password before linking.
 * A user already linked to a different Google account stays linked to it until an admin unlinks it.
 */
export function resolveGoogleUser(identity: GoogleIdentity): GoogleResolution {
  const linked = usersRepo.getByGoogleSub(identity.sub);
  if (linked) return linked.active ? { user: linked } : { denied: "account_inactive" };

  const candidate = usersRepo.getByEmail(identity.email);
  if (!candidate) return { denied: "not_registered" };
  if (!candidate.active) return { denied: "account_inactive" };

  if (candidate.google_sub) return { denied: "account_conflict" };
  return { user: candidate, linkRequired: true };
}
