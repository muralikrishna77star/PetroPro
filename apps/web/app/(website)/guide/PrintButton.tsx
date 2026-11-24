"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="glass-btn inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium"
    >
      <Printer className="h-4 w-4" aria-hidden="true" /> Save as PDF
    </button>
  );
}
