import path from "node:path";

const apiPublicUrl = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "petropro-dev-secret-change-me",
  dbPath: process.env.DB_PATH ?? path.resolve(process.cwd(), "data", "petropro.db"),
  // Where the browser lands after Google sign-in (see routes/googleAuth.ts) — the web app's own
  // origin, not the API's.
  webAppUrl: process.env.WEB_APP_URL ?? "http://localhost:3000",
  // Google Sign-In is entirely optional — routes/googleAuth.ts checks these are both set before
  // doing anything, so a deployment that never configures Google just doesn't offer the button.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? `${apiPublicUrl}/auth/google/callback`,
};
