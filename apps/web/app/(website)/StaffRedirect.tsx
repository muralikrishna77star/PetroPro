"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession, homeRouteFor } from "@/lib/auth";

/** Staff who are already signed in go straight to their own screen rather than the website. */
export function StaffRedirect() {
  const router = useRouter();
  useEffect(() => {
    const session = getSession();
    if (session) router.replace(homeRouteFor(session));
  }, [router]);
  return null;
}
