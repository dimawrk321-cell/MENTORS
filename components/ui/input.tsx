import type * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-control border border-border bg-transparent px-3 text-[14px] text-text-1 placeholder:text-text-3",
        "transition-colors duration-150 ease-app hover:border-border-strong",
        "disabled:pointer-events-none disabled:opacity-50",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
