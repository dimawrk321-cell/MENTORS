import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "border border-border bg-transparent hover:border-border-strong hover:bg-surface-2",
  ghost: "bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-2",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-[14px]",
  lg: "h-10 px-5 text-[14px]",
};

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  asChild = false,
  loading = false,
  disabled,
  type,
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 select-none rounded-control font-medium",
    "transition-[color,background-color,border-color,transform] duration-150 ease-app",
    "active:scale-[0.98]",
    "disabled:opacity-50 disabled:pointer-events-none",
    // Touch target (spec 13/14: ≥44px on mobile). Mirrors the header icon-button
    // pattern (size-11 md:size-9): compact on desktop, thumb-sized on phones.
    "max-md:min-h-11",
    variantClasses[variant],
    sizeClasses[size],
    // DECISION: when loading, mirror the disabled affordance on the wrapper too
    // (aria-disabled path for asChild), since `disabled:` variants only match
    // native disabled buttons.
    loading && "opacity-50 pointer-events-none",
    className,
  );

  if (asChild) {
    // DECISION: with asChild the child element owns its content, so the loading
    // spinner and disabled attribute are not injected — only classes and
    // aria-disabled are applied (spec: ignore loading spinner logic for Slot).
    return (
      <Slot className={classes} aria-disabled={loading || undefined} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button type={type ?? "button"} className={classes} disabled={disabled || loading} {...props}>
      {loading && (
        <Loader2 className="animate-spin" size={16} strokeWidth={1.75} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}
