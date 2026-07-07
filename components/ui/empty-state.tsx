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
        <div className="rounded-pill border-border bg-surface-2 mb-3 flex size-10 items-center justify-center border">
          <Icon size={20} strokeWidth={1.75} className="text-text-3" />
        </div>
      ) : null}
      {/* DECISION: h3 for the heading — empty states sit inside page sections, never as the page title. */}
      <h3 className="text-text-1 text-[16px] font-semibold">{title}</h3>
      {description ? <p className="text-text-2 max-w-[38ch] text-[14px]">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
