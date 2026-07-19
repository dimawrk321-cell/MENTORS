"use client";

import type * as React from "react";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils/cn";

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "rounded-control border-border text-text-1 inline-flex h-11 w-full items-center justify-between gap-2 border bg-transparent px-3 text-[14px] md:h-9",
        "ease-app hover:border-border-strong transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-[placeholder]:text-text-3",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={16} strokeWidth={1.75} className="text-text-3 shrink-0" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={sideOffset}
        className={cn(
          "rounded-control border-border bg-surface-2 shadow-surface-2 z-50 min-w-[8rem] overflow-hidden border p-1",
          "animate-[fade-in_150ms_var(--ease)]",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            position === "popper" &&
              "max-h-[var(--radix-select-content-available-height)] w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      // DECISION: highlighted row uses bg-accent/10 — surface-1 is invisible on
      // surface-2 in the light theme (both are #ffffff) and the Tailwind dark:
      // variant is not wired to data-theme, so a translucent accent wash is the
      // one token-based option that reads on surface-2 in both themes.
      className={cn(
        "relative flex cursor-default items-center rounded-[6px] py-1.5 pr-8 pl-2.5 text-[14px] outline-none select-none",
        "data-[highlighted]:bg-accent/10 data-[highlighted]:text-text-1",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
        <Check size={16} strokeWidth={1.75} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn("text-text-3 px-2.5 py-1.5 text-[12px]", className)}
      {...props}
    />
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("bg-border my-1 h-px", className)} {...props} />;
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
};
