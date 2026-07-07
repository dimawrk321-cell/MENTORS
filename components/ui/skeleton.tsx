import type * as React from "react";

import { cn } from "@/lib/utils/cn";

/*
 * Skeleton = content geometry + shimmer (spec 5.3). Caller shapes it via
 * className (width/height/radius overrides).
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      // DECISION: fill uses the translucent border token and the sweep uses
      // text-1 at 5% — surface-2 / white are invisible on the light theme
      // (#FFFFFF on #FAFAF9), while these alpha tokens read on both themes.
      className={cn(
        "rounded-control bg-border relative overflow-hidden",
        "after:absolute after:inset-0 after:-translate-x-full",
        "after:animate-[shimmer_1.6s_infinite]",
        "after:via-text-1/[0.05] after:bg-gradient-to-r after:from-transparent after:to-transparent",
        className,
      )}
      {...props}
    />
  );
}
