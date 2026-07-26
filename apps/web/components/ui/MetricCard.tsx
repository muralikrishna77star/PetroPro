"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export type MetricColor = "primary" | "secondary" | "success" | "warning" | "error";

const ICON_BG: Record<MetricColor, string> = {
  primary: "bg-primary/15 text-primary",
  secondary: "bg-secondary/15 text-secondary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/15 text-error",
};

export function MetricCard({
  label,
  value,
  icon: Icon,
  color = "primary",
  hint,
  index = 0,
  size = "md",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  color?: MetricColor;
  hint?: string;
  index?: number;
  /** "lg" is for viewing the dashboard from across a room (a big screen / TV) — larger value
   *  text and icon, same layout. */
  size?: "md" | "lg";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05 }}
      className={cn("rounded-2xl border border-border bg-card shadow-sm", size === "lg" ? "p-7" : "p-5")}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className={cn("text-fg-muted", size === "lg" ? "text-lg" : "text-sm")}>{label}</p>
          <p className={cn("mt-1 font-mono font-semibold text-fg", size === "lg" ? "text-5xl" : "text-2xl")}>
            {value}
          </p>
          {hint && <p className={cn("mt-1 text-fg-muted", size === "lg" ? "text-sm" : "text-xs")}>{hint}</p>}
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl",
            size === "lg" ? "h-14 w-14" : "h-10 w-10",
            ICON_BG[color],
          )}
        >
          <Icon size={size === "lg" ? 28 : 20} />
        </span>
      </div>
    </motion.div>
  );
}
