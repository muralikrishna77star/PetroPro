import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/Card";

/** Visually-complete but honest stand-in for a Design Bible widget with no real data source
 *  yet (no tank-sensor/pump-telemetry/weather-API/AI integration exists) — shows the intended
 *  shape without fabricating numbers. Swap for a real widget once the integration exists. */
export function PlaceholderWidget({
  title,
  icon: Icon,
  reason,
}: {
  title: string;
  icon: LucideIcon;
  reason: string;
}) {
  return (
    <Card color="zinc" className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-card-hover text-fg-muted">
        <Icon size={20} />
      </span>
      <p className="font-heading text-sm font-semibold text-fg">{title}</p>
      <p className="max-w-xs text-xs text-fg-muted">{reason}</p>
      <span className="mt-1 inline-flex items-center rounded-full bg-card-hover px-2.5 py-0.5 text-[11px] font-medium text-fg-muted">
        Not yet connected
      </span>
    </Card>
  );
}
