"use client";

import { useState } from "react";
import type * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";

// Password field with a show/hide toggle (spec 13.4/4.3). Forwards every input prop
// (name, value, autoComplete, required…) and just owns the visible/hidden state. The
// toggle is a ≥44px touch target on mobile, keyboard-focusable with an aria-label,
// and works in both themes. `type` is controlled here — callers omit it.
export function PasswordInput({ className, ...props }: React.ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-11", className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
        aria-pressed={visible}
        className="text-text-3 ease-app hover:text-text-1 focus-visible:text-text-1 rounded-control absolute inset-y-0 right-0 flex w-11 items-center justify-center transition-colors duration-150 outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] md:w-9"
      >
        {visible ? (
          <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Eye size={18} strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
