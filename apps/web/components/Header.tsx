"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { clearSession, ROLE_LABELS, type Session } from "@/lib/auth";
import { api, type Tenant } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ColorStyleSwitcher } from "@/components/ColorStyleSwitcher";
import { Button } from "@/components/ui/Button";

/** Top app bar for the authenticated shell — a contrast band (bg-card against the page's
 *  bg-bg) with the dealer letterhead (from HEADINGS.DBF, via /tenant) centered in the
 *  remaining space, and the user menu/sign-out pinned to the top right. */
export function Header({ session, onOpenMenu }: { session: Session; onOpenMenu: () => void }) {
  const router = useRouter();
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    api.getTenant(session.token).then(setTenant).catch(() => undefined);
  }, [session.token]);

  return (
    <header className="relative flex h-16 shrink-0 items-center justify-end gap-2 border-b border-border bg-card px-3 md:gap-4 md:px-6">
      <Button type="button" variant="ghost" size="sm" aria-label="Open menu" className="mr-auto md:hidden" onClick={onOpenMenu}>
        <Menu size={20} />
      </Button>
      {tenant && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-center lg:block">
          <p className="font-heading text-sm font-semibold text-fg">{tenant.name}</p>
          {tenant.address_line1 && <p className="text-xs text-fg-muted">{tenant.address_line1}</p>}
          {tenant.address_line2 && <p className="text-xs text-fg-muted">{tenant.address_line2}</p>}
        </div>
      )}

      <div className="hidden md:block">
        <ColorStyleSwitcher />
      </div>
      <ThemeToggle />
      <div className="hidden h-6 w-px bg-border sm:block" />
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-sm font-medium text-fg">{session.name}</p>
        <p className="text-xs text-fg-muted">{ROLE_LABELS[session.role]}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          clearSession();
          router.replace("/login");
        }}
      >
        <LogOut size={16} />
        Sign out
      </Button>
    </header>
  );
}
