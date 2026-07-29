"use client";

import { useId, useMemo, useState, type InputHTMLAttributes } from "react";
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

const MAX_VISIBLE_OPTIONS = 50;

/** Type-to-filter autocomplete for master-data pickers (items, groups, customers, vehicles,
 *  pumps) — a real dropdown that filters as you type and is selectable by click or keyboard,
 *  replacing the native `<input list>`/`<datalist>` this used to be (inconsistent filtering and
 *  styling across browsers, no keyboard highlight). `value` still updates on every keystroke
 *  (not only on selecting a suggestion) — callers rely on free text being possible, e.g. typing
 *  a customer code that isn't in the loaded list yet. */
export function Combobox({ options, value, onChange, className, id, ...props }: ComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const filtered = useMemo(() => {
    const needle = value.trim().toLowerCase();
    const matches = needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle))
      : options;
    return matches.slice(0, MAX_VISIBLE_OPTIONS);
  }, [options, value]);

  // Derived, not stored — clamping via a useEffect+setState would cause an extra render every
  // time the filtered set shrinks (e.g. on every keystroke that narrows the match list).
  const activeIndex = filtered.length === 0 ? -1 : Math.min(highlighted, filtered.length - 1);

  function selectOption(option: ComboboxOption) {
    onChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open || filtered.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((activeIndex + 1) % filtered.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((activeIndex - 1 + filtered.length) % filtered.length);
        break;
      case "Enter":
        if (filtered[activeIndex]) {
          e.preventDefault();
          selectOption(filtered[activeIndex]);
        }
        break;
      case "Escape":
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className="relative">
      <input
        {...props}
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[activeIndex] ? `${listboxId}-${filtered[activeIndex].value}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-10 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg placeholder:text-fg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/60 disabled:opacity-50",
          className,
        )}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full min-w-max overflow-auto rounded-lg border border-border bg-bg-elevated py-1 text-sm shadow-lg"
        >
          {filtered.map((option, i) => (
            <li
              key={option.value}
              id={`${listboxId}-${option.value}`}
              role="option"
              aria-selected={option.value === value}
              // onMouseDown (not onClick) fires before the input's onBlur, and preventDefault
              // keeps focus on the input so blur never closes the dropdown out from under the click.
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(option);
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={cn(
                "cursor-pointer whitespace-nowrap px-3 py-1.5",
                i === activeIndex ? "bg-primary text-white" : "text-fg hover:bg-card-hover",
              )}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
