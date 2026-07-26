"use client";

import { useEffect, useState } from "react";
import { getSession, type Session } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { ColorStyleProvider } from "@/components/ColorStyleProvider";

/** Shared shell (sidebar + content frame) for every authenticated page. Deliberately does not
 *  duplicate auth/role gating here — each page still calls useRequireSession(allowedRoles)
 *  itself, since that's what knows which roles that specific page allows. This layout just
 *  renders the chrome once a session is present; if there's none, it renders children bare and
 *  lets the page's own hook redirect to /login. */
export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from localStorage, an external system
    setSession(getSession());
  }, []);

  if (!session) {
    return <ColorStyleProvider>{children}</ColorStyleProvider>;
  }

  return (
    <ColorStyleProvider>
      <div className="flex h-screen overflow-hidden bg-bg">
        <Sidebar session={session} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header session={session} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
          </main>
        </div>
      </div>
    </ColorStyleProvider>
  );
}
