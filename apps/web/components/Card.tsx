"use client";

import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { useColorStyle } from "@/components/ColorStyleProvider";
import { cn } from "@/lib/cn";

/** Matches NavBar's group colors so a page visually ties back to the dropdown that links to it
 *  (Maintenance=emerald, Bill=orange, Reports=violet, Utilities=teal, Search=amber); "zinc" is
 *  the neutral default for screens with no legacy-menu group (dashboard, login, shifts). */
export type CardColor = "orange" | "emerald" | "violet" | "teal" | "amber" | "zinc" | "error";

const BORDER_L_COLORS: Record<CardColor, string> = {
  orange: "border-l-orange-500",
  emerald: "border-l-emerald-500",
  violet: "border-l-violet-500",
  teal: "border-l-teal-500",
  amber: "border-l-amber-500",
  zinc: "border-l-border",
  error: "border-l-error",
};

const TINT_BG: Record<CardColor, string> = {
  orange: "bg-orange-500/8",
  emerald: "bg-emerald-500/8",
  violet: "bg-violet-500/8",
  teal: "bg-teal-500/8",
  amber: "bg-amber-500/8",
  zinc: "bg-card",
  error: "bg-error/8",
};

const HEADER_BAR: Record<CardColor, string> = {
  orange: "bg-orange-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
  zinc: "bg-border",
  error: "bg-error",
};

type CardProps<T extends ElementType> = {
  as?: T;
  color?: CardColor;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "color" | "className" | "children">;

export function Card<T extends ElementType = "section">({
  as,
  color = "zinc",
  className = "",
  children,
  ...rest
}: CardProps<T>) {
  const Tag = as ?? "section";
  const { style } = useColorStyle();

  if (style === "header-bars") {
    return (
      <Tag className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-sm", className)} {...rest}>
        <div className={cn("h-1.5", HEADER_BAR[color])} />
        <div className="p-5">{children}</div>
      </Tag>
    );
  }

  // "vibrant-sidebar" carries all the color in the sidebar instead — cards stay plain here.
  const noAccent = style === "vibrant-sidebar";
  const tinted = style === "tinted" || style === "bold";

  return (
    <Tag
      className={cn(
        "rounded-2xl border border-border p-5 shadow-sm",
        noAccent ? "bg-card" : cn("border-l-4", BORDER_L_COLORS[color], tinted ? TINT_BG[color] : "bg-card"),
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
