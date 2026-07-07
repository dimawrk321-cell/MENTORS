"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Sheet — мобильная шторка (spec 5.3; built at stage 2 with its first real
// consumer, the lesson table of contents — spec changelog).

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-[fade-in_150ms_var(--ease)] bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto",
          "rounded-t-card border-border bg-surface-2 shadow-surface-2 border-t px-5 pt-3 pb-8",
          "animate-[sheet-up_200ms_var(--ease)]",
          className,
        )}
        {...props}
      >
        {/* Grab handle */}
        <div aria-hidden="true" className="rounded-pill bg-border-strong mx-auto mb-4 h-1 w-9" />
        {children}
        <DialogPrimitive.Close
          aria-label="Закрыть"
          className="text-text-3 hover:text-text-1 absolute top-4 right-4 rounded-[6px] transition-colors duration-150"
        >
          <X size={16} strokeWidth={1.75} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn("mb-3 text-[16px] font-semibold", className)} {...props} />
  );
}
