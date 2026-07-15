"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type ToastVariant = "default" | "success" | "danger";

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Опциональный монохромный глиф слева (достижения — spec 5.6). */
  icon?: React.ReactNode;
}

interface ToastItem extends ToastOptions {
  id: number;
}

/* Module-level store: any client component can call toast() without context. */
let idCounter = 0;
let toastItems: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function toast(options: ToastOptions): void {
  idCounter += 1;
  toastItems = [...toastItems, { id: idCounter, ...options }];
  emit();
}

function dismiss(id: number): void {
  toastItems = toastItems.filter((item) => item.id !== id);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ToastItem[] {
  return toastItems;
}

const serverSnapshot: ToastItem[] = [];

function getServerSnapshot(): ToastItem[] {
  return serverSnapshot;
}

const variantClasses: Record<ToastVariant, string> = {
  default: "",
  success: "border-l-2 border-l-success",
  danger: "border-l-2 border-l-danger",
};

/** Mounted once in the root layout; renders the toast stack (spec 5.3). */
function Toaster() {
  const items = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <ToastPrimitive.Provider duration={4000} swipeDirection="right">
      {items.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          onOpenChange={(open) => {
            if (!open) {
              dismiss(item.id);
            }
          }}
          className={cn(
            "rounded-card border-border bg-surface-2 shadow-surface-2 relative flex animate-[fade-in_200ms_var(--ease)] gap-3 border p-4 pr-9",
            "data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-full data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none",
            variantClasses[item.variant ?? "default"],
          )}
        >
          {item.icon ? <span className="mt-0.5 shrink-0">{item.icon}</span> : null}
          <div className="min-w-0">
            <ToastPrimitive.Title className="text-text-1 text-[14px] font-medium">
              {item.title}
            </ToastPrimitive.Title>
            {item.description ? (
              <ToastPrimitive.Description className="text-text-2 text-[13px]">
                {item.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close
            aria-label="Закрыть"
            className="text-text-3 ease-app hover:text-text-1 absolute top-3 right-3 transition-colors duration-150"
          >
            <X size={14} strokeWidth={1.75} />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      {/* max-md:bottom-20 clears the mobile bottom navigation (visible below md).
          No outline-none — the viewport is focusable via hotkey, spec 14 keeps rings visible. */}
      <ToastPrimitive.Viewport
        label="Уведомления ({hotkey})"
        className="fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 max-md:bottom-20"
      />
    </ToastPrimitive.Provider>
  );
}

export { Toaster, toast, type ToastOptions, type ToastVariant };
