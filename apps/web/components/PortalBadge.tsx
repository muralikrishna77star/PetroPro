import type { Role } from "@/lib/auth";
import { portalForRole } from "@/lib/auth";

export function PortalBadge({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
      {portalForRole(role)}
    </span>
  );
}
