"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Offline banner (spec 5.5): a mobile bar shown while the browser reports no
 * network. Input is never lost — this only informs; forms keep their state and
 * server actions retry on reconnect. Mobile-only (md:hidden): the desktop app is
 * assumed wired, and the bar would compete with the sidebar.
 */
export function OfflineBanner() {
  // Start "online" so SSR and the first client paint agree (no hydration flash);
  // the effect corrects it immediately if the device is actually offline.
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-warning/12 text-warning border-warning/25 fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 border-b px-4 py-2 text-[13px] font-medium backdrop-blur md:hidden"
    >
      <WifiOff size={15} strokeWidth={1.75} aria-hidden="true" />
      Нет соединения — проверь интернет
    </div>
  );
}
