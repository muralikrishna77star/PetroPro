export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Baked in at build time — set NEXT_PUBLIC_GOOGLE_SSO_ENABLED=true only for deployments where the
// API also has GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET configured (config.ts on the API side), so
// the "Sign in with Google" button doesn't appear where it can't actually work.
export const GOOGLE_SSO_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_SSO_ENABLED === "true";
