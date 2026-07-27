"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCustomerSession, type CustomerSession } from "./customerAuth";

/** Redirects to /customer/login if there's no customer session. Mirrors lib/useSession.ts's
 *  useRequireSession but for the customer portal, never the staff one. */
export function useRequireCustomerSession(): CustomerSession | null {
  const router = useRouter();
  const [session, setSession] = useState<CustomerSession | null | undefined>(undefined);

  useEffect(() => {
    const current = getCustomerSession();
    if (!current) {
      router.replace("/customer/login");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from localStorage, an external system
    setSession(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return session ?? null;
}
