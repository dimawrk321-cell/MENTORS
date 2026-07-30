import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

// Page heading (design handoff): screen h1 at 28px/700/-0.02em with an optional
// 14px secondary subtitle, and an optional right-aligned actions slot. Shared so
// every screen title has the same scale/rhythm.
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="text-text-2 mt-1.5 max-w-[60ch] text-[14px]">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
