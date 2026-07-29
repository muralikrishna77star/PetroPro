"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Fuel } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { API_URL, GOOGLE_SSO_ENABLED } from "@/lib/config";
import { saveSession, homeRouteForRole } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  not_registered: "No PetroPro account is linked to that Google account — ask an admin to add your email under Users.",
  google_failed: "Google sign-in failed. Please try again or sign in with your user ID and password.",
};

export default function LoginPage() {
  const router = useRouter();
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Read via window.location rather than useSearchParams() — this page is otherwise fully
  // static, and useSearchParams() would force it into a Suspense-gated client-side render just
  // to show a one-off error banner after a failed Google redirect.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from the URL, an external system
    if (code) setGoogleError(code);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.login(userId, password);
      saveSession({ token, userId: user.user_id, name: user.name, role: user.role });
      router.push(homeRouteForRole(user.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-bg px-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-secondary/20 blur-3xl" />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
            <Fuel size={22} />
          </span>
          <div>
            <h1 className="font-heading text-xl font-semibold text-fg">PetroPro</h1>
            <p className="text-xs text-fg-muted">Fuel Station Management Platform</p>
          </div>
        </div>

        <label className="mb-1 block text-sm font-medium text-fg-muted">User ID</label>
        <Input
          className="mb-4"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          autoComplete="username"
          required
        />

        <label className="mb-1 block text-sm font-medium text-fg-muted">Password</label>
        <Input
          type="password"
          className="mb-6"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {googleError && (
          <p className="mb-4 text-sm text-error">
            {GOOGLE_ERROR_MESSAGES[googleError] ?? "Google sign-in failed. Please try again."}
          </p>
        )}
        {error && <p className="mb-4 text-sm text-error">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Signing in..." : "Sign in"}
        </Button>

        {GOOGLE_SSO_ENABLED && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-fg-muted">
              <div className="h-px flex-1 bg-border" />
              or
              <div className="h-px flex-1 bg-border" />
            </div>
            <a
              href={`${API_URL}/auth/google`}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-card-hover"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.81.54-1.85.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z"
                />
                <path fill="#FBBC05" d="M3.95 10.7a5.4 5.4 0 0 1 0-3.4V4.97H.94a9 9 0 0 0 0 8.06l3.01-2.33Z" />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58Z"
                />
              </svg>
              Sign in with Google
            </a>
          </>
        )}
      </form>
    </div>
  );
}
