"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, X } from "lucide-react";

// Closeable «подтверди почту» banner (spec 12.1/C8). Non-blocking; dismissal is
// local only (no persistence — it reappears next load until the email is verified,
// which removes it server-side). The code form lives in the profile.
export function EmailVerifyBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="rounded-card border-border bg-surface-1 mb-4 flex items-start gap-3 border px-4 py-3">
      <Mail
        size={18}
        strokeWidth={1.75}
        className="text-warning mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-[14px]">
        Подтверди почту — мы отправили код на твой email.{" "}
        <Link href="/profile" className="text-accent hover:underline">
          Ввести код в профиле
        </Link>
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Скрыть"
        className="text-text-3 ease-app hover:text-text-1 -mr-1 flex size-6 shrink-0 items-center justify-center transition-colors duration-150"
      >
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
