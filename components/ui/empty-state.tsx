import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Spec 5.3: exactly one action. */
  action?: React.ReactNode;
  /** «warning» tints the icon circle for blocking states (нет доступа). */
  tone?: "neutral" | "warning";
  className?: string;
}

/** Icon + heading + text + one action (spec 5.3). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <div
          className={cn(
            "rounded-pill mb-3 flex items-center justify-center",
            tone === "warning"
              ? "bg-warning/12 text-warning size-11"
              : "border-border bg-surface-2 text-text-3 size-10 border",
          )}
        >
          <Icon size={20} strokeWidth={1.75} />
        </div>
      ) : null}
      {/* DECISION: h3 for the heading — empty states sit inside page sections, never as the page title. */}
      <h3 className="text-text-1 text-[16px] font-semibold">{title}</h3>
      {description ? <p className="text-text-2 max-w-[38ch] text-[14px]">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
