import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg transition-colors focus:outline-none focus:ring-2 focus:ring-primary/60 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
