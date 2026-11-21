"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession, homeRouteForRole } from "@/lib/auth";

/**
 * Where the installed app opens (manifest start_url) and the service worker's offline fallback.
 * It sends staff to their own home screen, or to sign in. The public website now lives at "/".
 */
export default function Start() {
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    router.replace(session ? homeRouteForRole(session.role) : "/login");
  }, [router]);

  return null;
}
