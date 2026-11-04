"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Fuel } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { saveSession, homeRouteForRole } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { LoginResponse } from "@petropro/shared-types";

/** Lands here after routes/googleAuth.ts's callback, with a single-use ticket in the URL fragment
 *  (fragments never reach a server). Either finishes the sign-in, or, the first time this Google
 *  account is used, asks for the PetroPro password that links the two. */
export default function LoginCallbackPage() {
  const router = useRouter();
  const [linkTicket, setLinkTicket] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function finish({ token, user }: LoginResponse) {
    saveSession({ token, userId: user.user_id, name: user.name, role: user.role });
    router.replace(homeRouteForRole(user.role));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname);

    const handoff = params.get("handoff");
    const link = params.get("link");
    /* eslint-disable react-hooks/set-state-in-effect -- bridging from the URL, an external system */
    if (link) {
      setLinkTicket(link);
      setEmail(params.get("email") ?? "");
    } else if (handoff) {
      api.googleExchange(handoff).then(finish, (err) => {
        setExpired(true);
        setError(err instanceof ApiError ? err.message : "Google sign-in didn't complete. Please try again.");
      });
    } else {
      setExpired(true);
      setError("Google sign-in didn't complete correctly. Please try again.");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on arrival
  }, []);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!linkTicket) return;
    setSubmitting(true);
    setError(null);
    try {
      finish(await api.googleLink(linkTicket, password));
    } catch (err) {
      setPassword("");
      setError(err instanceof ApiError ? err.message : "Could not reach PetroPro. Check your connection and try again.");
      if (err instanceof ApiError && (err.status === 400 || err.status === 409)) setExpired(true);
    } finally {
      setSubmitting(false);
    }
  }

  const backToSignIn = (
    <a href="/login" className="text-sm text-primary underline">
      Back to sign in
    </a>
  );

  if (linkTicket && !expired) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg px-4">
        <form onSubmit={confirm} className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
              <Fuel size={22} />
            </span>
            <h1 className="font-heading text-xl font-semibold text-fg">Confirm it&apos;s you</h1>
          </div>
          <p className="mb-4 break-words text-sm text-fg-muted">
            To link <span className="font-medium text-fg">{email}</span> to your PetroPro account, enter your PetroPro
            password. You&apos;ll only need to do this once.
          </p>
          <label htmlFor="link-password" className="mb-1 block text-sm font-medium text-fg-muted">
            PetroPro password
          </label>
          <Input
            id="link-password"
            type="password"
            className="mb-4"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          {error && (
            <p role="alert" className="mb-4 text-sm text-error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Confirming..." : "Confirm and link"}
          </Button>
          <p className="mt-4 text-xs text-fg-muted">
            Forgotten your password, or never had one? Your administrator can reset it from the Users screen.
          </p>
          <div className="mt-3">{backToSignIn}</div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-bg px-4">
      {error ? (
        <div className="text-center">
          <p role="alert" className="mb-4 text-sm text-error">
            {error}
          </p>
          {backToSignIn}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Signing you in...</p>
      )}
    </div>
  );
}
