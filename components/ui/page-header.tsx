import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

// Page heading (design handoff): screen h1 with an optional secondary subtitle
// and an optional right-aligned actions slot. Shared so every screen title has
// the same scale/rhythm. `size` picks the scale: "lg" (default) = the student
// zone's 28/700/-0.02em; "admin" = the denser 24/600/-0.01em the admin
// prototypes use.
export function PageHeader({
  title,
  subtitle,
  actions,
  size = "lg",
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  size?: "lg" | "admin";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h1
          className={cn(
            "leading-[1.2]",
            size === "admin"
              ? "text-[24px] font-semibold tracking-[-0.01em]"
              : "text-[28px] font-bold tracking-[-0.02em]",
          )}
        >
          {title}
        </h1>
        {subtitle && <p className="text-text-2 mt-1.5 max-w-[60ch] text-[14px]">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
