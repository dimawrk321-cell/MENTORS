import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Spec 5.3: exactly one action. */
  action?: React.ReactNode;
  className?: string;
}

/** Icon + heading + text + one action (spec 5.3). */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-pill border border-border bg-surface-2">
          <Icon size={20} strokeWidth={1.75} className="text-text-3" />
        </div>
      ) : null}
      {/* DECISION: h3 for the heading — empty states sit inside page sections, never as the page title. */}
      <h3 className="text-[16px] font-semibold text-text-1">{title}</h3>
      {description ? <p className="max-w-[38ch] text-[14px] text-text-2">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
