"use client";

import { useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list"> {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
}

/** Type-to-filter input backed by a native <datalist> — for master-data pickers (items, groups,
 *  customers, vehicles) where the list can be long enough that scrolling a <select> is slower
 *  than typing a few letters. Bound value is the option's `value` (e.g. an item code); `label`
 *  is shown alongside it in the browser's suggestion list. No extra dependency: this is plain
 *  HTML, same pattern the billing page's customer-code field already used. */
export function Combobox({ options, value, onChange, className, ...props }: ComboboxProps) {
  const listId = useId();
  return (
    <>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className={cn(
          "h-10 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg placeholder:text-fg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/60 disabled:opacity-50",
          className,
        )}
        {...props}
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </datalist>
    </>
  );
}
