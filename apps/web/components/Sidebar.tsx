"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Boxes,
  ChevronDown,
  ClipboardList,
  Clock,
  Fuel,
  LayoutDashboard,
  Receipt,
  Search,
  Settings,
} from "lucide-react";
import { type Role, type Session } from "@/lib/auth";
import { PortalBadge } from "@/components/PortalBadge";
import { useColorStyle } from "@/components/ColorStyleProvider";
import { cn } from "@/lib/cn";

type ColorKey = "orange" | "emerald" | "violet" | "teal" | "amber";

interface NavLink {
  href: string;
  label: string;
  roles: Role[];
}

interface NavGroup {
  label: string;
  color: ColorKey;
  icon: typeof Boxes;
  items: NavLink[];
}

/** Mirrors legacy/Workarea/MAINMENU.PRG's pad/popup structure (docs/MODULES.md has the full
 *  mapping) — one section per legacy pad, containing only pages that actually exist today. */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Maintenance",
    color: "emerald",
    icon: Boxes,
    items: [
      { href: "/catalog", label: "Catalog", roles: ["super_admin", "owner"] },
      { href: "/customers", label: "Customers", roles: ["super_admin", "owner", "operator"] },
      { href: "/purchases", label: "Purchases", roles: ["super_admin", "owner"] },
    ],
  },
  {
    label: "Bill",
    color: "orange",
    icon: Receipt,
    items: [
      { href: "/billing", label: "Billing", roles: ["super_admin", "owner", "operator"] },
      { href: "/cashier", label: "Cashier Queue", roles: ["super_admin", "owner", "operator"] },
      { href: "/attendant", label: "Attendant", roles: ["field_operator"] },
    ],
  },
  {
    label: "Reports",
    color: "violet",
    icon: ClipboardList,
    items: [
      { href: "/reports", label: "Sales / Bill Reports", roles: ["super_admin", "owner"] },
      { href: "/reports", label: "GST / Tax Reports", roles: ["super_admin", "owner"] },
      { href: "/reports", label: "Stock Reports", roles: ["super_admin", "owner"] },
    ],
  },
  {
    label: "Search",
    color: "amber",
    icon: Search,
    items: [{ href: "/rate-changes", label: "Rate Changes", roles: ["super_admin", "owner"] }],
  },
  {
    label: "Utilities",
    color: "teal",
    icon: Settings,
    items: [
      { href: "/users", label: "Users", roles: ["super_admin"] },
      { href: "/audit-logs", label: "Audit Logs", roles: ["super_admin", "owner"] },
      { href: "/settings", label: "Settings", roles: ["super_admin", "owner"] },
    ],
  },
];

/** No legacy analog (dashboard/shifts are PWA-only additions) — kept as direct links. */
const UNGROUPED: (NavLink & { icon: typeof LayoutDashboard })[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["super_admin", "owner"] },
  {
    href: "/shifts",
    label: "Shifts",
    icon: Clock,
    roles: ["super_admin", "owner", "operator", "field_operator"],
  },
];

const DOT_COLORS: Record<ColorKey, string> = {
  orange: "bg-orange-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
};

const ICON_COLORS: Record<ColorKey, string> = {
  orange: "text-orange-600",
  emerald: "text-emerald-600",
  violet: "text-violet-600",
  teal: "text-teal-600",
  amber: "text-amber-600",
};

const ACTIVE_BG: Record<ColorKey, string> = {
  orange: "bg-orange-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
};

function GroupSection({ group, items, pathname }: { group: NavGroup; items: NavLink[]; pathname: string | null }) {
  const active = items.some((item) => item.href === pathname);
  const [open, setOpen] = useState(true);
  const Icon = group.icon;
  const { style } = useColorStyle();
  const vivid = style === "vibrant-sidebar" || style === "bold";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide hover:text-fg",
          vivid ? ICON_COLORS[group.color] : "text-fg-muted",
        )}
      >
        <Icon size={14} />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown size={14} className={cn("transition-transform", open ? "" : "-rotate-90")} />
      </button>
      {open && (
        <div className="mb-1 ml-2 flex flex-col gap-0.5 border-l border-border pl-3">
          {items.map((item, i) => {
            const itemActive = item.href === pathname;
            return (
              <Link
                key={`${item.href}-${i}`}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  itemActive
                    ? vivid
                      ? cn(ACTIVE_BG[group.color], "font-medium text-white")
                      : "bg-primary/15 font-medium text-primary"
                    : "text-fg-muted hover:bg-card-hover hover:text-fg",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", DOT_COLORS[group.color])} />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
      {!open && active && <span className="ml-3 block h-0.5 w-6 rounded-full bg-primary" />}
    </div>
  );
}

export function Sidebar({ session }: { session: Session }) {
  const pathname = usePathname();

  const visibleGroups = NAV_GROUPS.map((group) => ({
    group,
    items: group.items.filter((item) => item.roles.includes(session.role)),
  })).filter(({ items }) => items.length > 0);

  const visibleUngrouped = UNGROUPED.filter((item) => item.roles.includes(session.role));

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white">
          <Fuel size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold text-fg">PetroPro</p>
          <PortalBadge role={session.role} />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-1 flex flex-col gap-0.5">
          {visibleUngrouped.map((item) => {
            const Icon = item.icon;
            const itemActive = item.href === pathname;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  itemActive ? "bg-primary text-white" : "text-fg-muted hover:bg-card-hover hover:text-fg",
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-col gap-1">
          {visibleGroups.map(({ group, items }) => (
            <GroupSection key={group.label} group={group} items={items} pathname={pathname} />
          ))}
        </div>
      </nav>
    </aside>
  );
}
