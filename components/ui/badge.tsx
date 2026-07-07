import type * as React from "react";
import { cn } from "@/lib/utils/cn";

type BadgeVariant = "default" | "accent" | "success" | "warning" | "danger";

const variantClasses: Record<BadgeVariant, string> = {
  default: "border border-border bg-surface-2 text-text-2",
  accent: "bg-accent/12 text-accent",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
};

export interface BadgeProps extends React.ComponentProps<"span"> {
  variant?: BadgeVariant;
}

/** Badge/Tag (spec 5.3): muted 12%-tinted pill. */
export function Badge({ variant = "default", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "rounded-pill inline-flex h-[22px] shrink-0 items-center px-2.5 text-[12px] font-medium whitespace-nowrap",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
