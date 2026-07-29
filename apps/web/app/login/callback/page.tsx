"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSession, homeRouteForRole, type Role } from "@/lib/auth";

const VALID_ROLES: Role[] = ["super_admin", "owner", "operator", "field_operator"];

/** Lands here after routes/googleAuth.ts's callback redirects the browser back with the session
 *  in the URL fragment (never a query string — fragments never reach the server, so the token
 *  can't end up in access logs). Reads it, stores the same session shape a password login would,
 *  and hands off to the same role-based landing page. */
export default function LoginCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    const userId = params.get("user_id");
    const name = params.get("name");
    const role = params.get("role");

    if (!token || !userId || !name || !role || !VALID_ROLES.includes(role as Role)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from the URL, an external system
      setError("Google sign-in didn't complete correctly. Please try again.");
      return;
    }

    saveSession({ token, userId, name, role: role as Role });
    router.replace(homeRouteForRole(role as Role));
  }, [router]);

  return (
    <div className="flex flex-1 items-center justify-center bg-bg px-4">
      {error ? (
        <div className="text-center">
          <p className="mb-4 text-sm text-error">{error}</p>
          <a href="/login" className="text-sm text-primary underline">
            Back to sign in
          </a>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Signing you in...</p>
      )}
    </div>
  );
}
