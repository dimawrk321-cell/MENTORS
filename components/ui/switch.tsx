"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils/cn";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      // p-[2px] + size-4 thumb: 36 - 4 = 32px track, 16px travel — the thumb is
      // vertically centered and flush at both ends.
      className={cn(
        "rounded-pill bg-border-strong relative inline-flex h-5 w-9 shrink-0 items-center p-[2px]",
        "ease-app transition-colors duration-150",
        "data-[state=checked]:bg-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        // Touch target (spec 13/14): the visual track stays 20×36, but on mobile a
        // transparent pseudo-element extends the tap area to ≥44px.
        "max-md:before:absolute max-md:before:-inset-3 max-md:before:content-['']",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "rounded-pill block size-4 translate-x-0 bg-white",
          "ease-app transition-transform duration-150",
          "data-[state=checked]:translate-x-4",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
