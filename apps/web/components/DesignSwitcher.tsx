"use client";

import { useEffect, useRef, useState } from "react";
import { Paintbrush } from "lucide-react";
import { applyDesign, currentDesign, DESIGNS, type Design } from "@/lib/design";
import { cn } from "@/lib/cn";

/** The Classic / Modern choice. Only rendered on signed-in screens, for staff and customers. */
export function DesignSwitcher() {
  const [design, setDesign] = useState<Design | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from the attribute set by the pre-paint script, an external system
    setDesign(currentDesign());
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
        title="Choose a design"
        aria-label="Choose a design"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-card-hover hover:text-fg"
      >
        <Paintbrush size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-border bg-card p-1 shadow-lg">
          {DESIGNS.map((d) => (
            <button
              key={d.value}
              type="button"
              aria-pressed={design === d.value}
              onClick={() => {
                applyDesign(d.value);
                setDesign(d.value);
                setOpen(false);
              }}
              className={cn(
                "block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                design === d.value ? "bg-primary/15 text-primary" : "text-fg hover:bg-card-hover",
              )}
            >
              <div className="font-medium">{d.label}</div>
              <div className="text-xs text-fg-muted">{d.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
