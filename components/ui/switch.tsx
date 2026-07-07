"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils/cn";

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      // p-[2px] + size-4 thumb: 36 - 4 = 32px track, 16px travel — the thumb is
      // vertically centered and flush at both ends.
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-pill bg-border-strong p-[2px]",
        "transition-colors duration-150 ease-app",
        "data-[state=checked]:bg-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-4 translate-x-0 rounded-pill bg-white",
          "transition-transform duration-150 ease-app",
          "data-[state=checked]:translate-x-4",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
