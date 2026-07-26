"use client";

import { useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { useColorStyle } from "@/components/ColorStyleProvider";
import { COLOR_STYLES } from "@/lib/colorStyle";
import { cn } from "@/lib/cn";

/** Lets a user try each of the multicolor treatments (see Card.tsx / Sidebar.tsx) and switch
 *  between them freely — the choice is persisted per-browser via ColorStyleProvider. */
export function ColorStyleSwitcher() {
  const { style, setStyle } = useColorStyle();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Card / sidebar color style"
        aria-label="Card / sidebar color style"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-card-hover hover:text-fg"
      >
        <Palette size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-border bg-card p-1 shadow-lg">
          {COLOR_STYLES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => {
                setStyle(s.value);
                setOpen(false);
              }}
              className={cn(
                "block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                style === s.value ? "bg-primary/15 text-primary" : "text-fg hover:bg-card-hover",
              )}
            >
              <div className="font-medium">{s.label}</div>
              <div className="text-xs text-fg-muted">{s.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
