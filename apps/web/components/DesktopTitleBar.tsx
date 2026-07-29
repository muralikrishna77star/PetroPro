"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const STORAGE_KEY = "petropro.desktop";
const CONTROL_PORT = process.env.NEXT_PUBLIC_DESKTOP_CONTROL_PORT ?? "4098";

/**
 * A kiosk window opened via `chrome --app --kiosk` (scripts/desktop/start.mjs) has no tab bar,
 * address bar, or window controls, and can't `window.close()` itself since it wasn't opened via
 * `window.open()` — same constraint WareCore's DesktopTitleBar works around. This renders nothing
 * in the ordinary browser/PWA case; only once `?desktop=1` has been seen (persisted to
 * localStorage so it survives client-side navigation away from that first URL) does it show a
 * slim bar with a Close button that tells the launcher's local control server to shut down.
 */
export function DesktopTitleBar() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("desktop") === "1";
    if (fromUrl) localStorage.setItem(STORAGE_KEY, "1");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from the URL/localStorage, an external system
    setIsDesktop(fromUrl || localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  if (!isDesktop) return null;

  function handleClose() {
    fetch(`http://127.0.0.1:${CONTROL_PORT}/shutdown`, { method: "POST" }).catch(() => undefined);
  }

  return (
    <div className="flex h-8 shrink-0 items-center justify-between bg-black px-3 text-xs text-white">
      <span className="font-medium tracking-wide">PetroPro</span>
      <button
        onClick={handleClose}
        title="Close PetroPro"
        className="flex items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-white/10"
      >
        <X size={12} />
        Close
      </button>
    </div>
  );
}
