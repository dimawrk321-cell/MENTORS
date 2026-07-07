"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex items-center gap-5 border-b border-border", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative -mb-px border-b-2 border-transparent pb-2.5 text-[14px] text-text-2",
        "transition-colors duration-150 ease-app hover:text-text-1",
        "data-[state=active]:border-accent data-[state=active]:text-text-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      // No outline-none: Radix Content is keyboard-focusable (tabIndex=0), the
      // global :focus-visible ring must stay visible (spec 14).
      className={cn("pt-5", className)}
      {...props}
    />
  );
}
