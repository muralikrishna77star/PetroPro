"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BILLING_ONLY_HOME, getSession, type Session, type Role } from "./auth";

/** Redirects to /login if there's no session, or if the session's role isn't allowed here. A
 *  "Billing screen only" cashier is sent back to Billing from any other page, by link or by URL. */
export function useRequireSession(allowedRoles?: Role[]): Session | null {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const current = getSession();
    // Before the role check, so a page cashiers can't open sends them back to Billing, not to sign in.
    if (current?.billingOnly && pathname !== BILLING_ONLY_HOME) {
      router.replace(BILLING_ONLY_HOME);
      return;
    }
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
