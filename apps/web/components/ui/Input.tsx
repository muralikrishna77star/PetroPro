import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg placeholder:text-fg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/60 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
