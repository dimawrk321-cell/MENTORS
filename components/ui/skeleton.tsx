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
      className={cn(
        "relative overflow-hidden rounded-control bg-surface-2",
        "after:absolute after:inset-0 after:-translate-x-full",
        "after:animate-[shimmer_1.6s_infinite]",
        "after:bg-gradient-to-r after:from-transparent after:via-white/[0.06] after:to-transparent",
        className,
      )}
      {...props}
    />
  );
}
