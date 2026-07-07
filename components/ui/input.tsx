import type * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "rounded-control border-border text-text-1 placeholder:text-text-3 h-9 w-full border bg-transparent px-3 text-[14px]",
        "ease-app hover:border-border-strong transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
