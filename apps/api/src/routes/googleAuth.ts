import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { config } from "../config.js";
import { usersRepo } from "../repositories/users.js";

const STATE_TTL_MS = 5 * 60 * 1000;

/**
 * CSRF `state` for the OAuth round-trip, HMAC-signed with the same secret the app already uses
 * for session JWTs — deliberately not a `fastify.jwt.sign()` call, since that's typed to the
 * staff/customer session payload shapes (plugins/auth.ts) and this carries neither. No cookie
 * needed either: the whole redirect-to-Google-and-back happens against this API's own origin, so
 * the state can just ride in the URL and be verified statelessly on return.
 */
function createState(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const expires = Date.now() + STATE_TTL_MS;
  const payload = `${nonce}.${expires}`;
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

function isValidState(state: string): boolean {
  try {
    const [nonce, expiresStr, sig] = Buffer.from(state, "base64url").toString("utf8").split(".");
    if (!nonce || !expiresStr || !sig) return false;
    const expectedSig = crypto.createHmac("sha256", config.jwtSecret).update(`${nonce}.${expiresStr}`).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
    return Date.now() < Number(expiresStr);
  } catch {
    return false;
  }
}

interface GoogleTokenResponse {
  access_token: string;
}

interface GoogleUserInfo {
  email?: string;
}

function googleConfigured(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

/**
 * Google Sign-In for staff — additive to the existing user-id/password login (routes/auth.ts),
 * never a replacement: a user with no email on file simply can't use this path and keeps using
 * their password. Matches by email against an *existing active* user (usersRepo.getByEmail) —
 * there is no auto-provisioning, so a stray Google account can never gain access on its own; an
 * admin has to have put that email on the user's profile first (Users page).
 */
export default async function googleAuthRoutes(fastify: FastifyInstance) {
  fastify.get("/auth/google", async (_request, reply) => {
    if (!googleConfigured()) {
      return reply.code(501).send({ error: "Google Sign-In is not configured on this server" });
    }
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: config.googleRedirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: createState(),
      prompt: "select_account",
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      if (!googleConfigured()) {
        return reply.code(501).send({ error: "Google Sign-In is not configured on this server" });
      }
      const { code, state, error } = request.query;
      if (error || !code || !state || !isValidState(state)) {
        return reply.redirect(`${config.webAppUrl}/login?error=google_failed`);
      }

      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: config.googleClientId,
            client_secret: config.googleClientSecret,
            redirect_uri: config.googleRedirectUri,
            grant_type: "authorization_code",
          }),
        });
        if (!tokenRes.ok) return reply.redirect(`${config.webAppUrl}/login?error=google_failed`);
        const tokenData = (await tokenRes.json()) as GoogleTokenResponse;

        const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (!profileRes.ok) return reply.redirect(`${config.webAppUrl}/login?error=google_failed`);
        const profile = (await profileRes.json()) as GoogleUserInfo;
        const email = profile.email?.toLowerCase();
        if (!email) return reply.redirect(`${config.webAppUrl}/login?error=google_failed`);

        const user = usersRepo.getByEmail(email);
        if (!user || !user.active) {
          return reply.redirect(`${config.webAppUrl}/login?error=not_registered`);
        }

        // Same staff session shape routes/auth.ts issues after a password login — Google is just
        // a second way to arrive at the same JWT. Carried in the URL fragment (not query string
        // or a redirect body) so it never lands in server access logs.
        const token = fastify.jwt.sign({ sub: user.user_id, role: user.role, name: user.name });
        const fragment = new URLSearchParams({ token, user_id: user.user_id, name: user.name, role: user.role });
        return reply.redirect(`${config.webAppUrl}/login/callback#${fragment}`);
      } catch {
        return reply.redirect(`${config.webAppUrl}/login?error=google_failed`);
      }
    },
  );
}
