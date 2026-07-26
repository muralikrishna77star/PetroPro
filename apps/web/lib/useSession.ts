"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, type Session, type Role } from "./auth";

/** Redirects to /login if there's no session, or if the session's role isn't allowed here. */
export function useRequireSession(allowedRoles?: Role[]): Session | null {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const current = getSession();
    if (!current || (allowedRoles && !allowedRoles.includes(current.role))) {
      router.replace("/login");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from localStorage, an external system
    setSession(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return session ?? null;
}
