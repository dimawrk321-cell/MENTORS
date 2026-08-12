"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  pushToast,
  toastCollapseKey,
  toastCountLabel,
  type StackedToast,
} from "@/lib/utils/toast-stack";

type ToastVariant = "default" | "success" | "warning" | "danger";

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Опциональный монохромный глиф слева (достижения — spec 5.6). */
  icon?: React.ReactNode;
  /**
   * Одно действие в тосте — «Вернуть» после удаления блока в редакторе.
   * Клик выполняет колбэк и закрывает тост.
   */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions, StackedToast {}

/* Module-level store: any client component can call toast() without context. */
let idCounter = 0;
let toastItems: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Правила стека (лимит, схлопывание однотипных) живут в чистом
 * `lib/utils/toast-stack.ts` — здесь только состояние и рендер.
 */
function toast(options: ToastOptions): void {
  idCounter += 1;
  toastItems = pushToast(toastItems, {
    id: idCounter,
    count: 1,
    collapseKey: toastCollapseKey({
      title: options.title,
      description: options.description,
      variant: options.variant,
      hasAction: Boolean(options.action),
    }),
    ...options,
  });
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
  // Предупреждение: действие выполнено, но у него есть последствие, о котором
  // надо сказать сразу (заход «Доступ к вопросам»: ключевая роль на черновике).
  warning: "border-l-2 border-l-warning",
  danger: "border-l-2 border-l-danger",
};

/** Авто-закрытие: 4с по spec 5.3; на мобильном короче — экран меньше. */
const TOAST_DURATION_DESKTOP_MS = 4000;
const TOAST_DURATION_MOBILE_MS = 2500;

/** Тот же брейкпоинт, что у BottomNav (spec 13: <768 — мобильный). */
function useCompactToasts(): boolean {
  const [compact, setCompact] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = (): void => setCompact(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return compact;
}

/** Mounted once in the root layout; renders the toast stack (spec 5.3). */
function Toaster() {
  const items = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const compact = useCompactToasts();

  return (
    <ToastPrimitive.Provider
      duration={compact ? TOAST_DURATION_MOBILE_MS : TOAST_DURATION_DESKTOP_MS}
      swipeDirection="right"
    >
      {items.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          onOpenChange={(open) => {
            if (!open) {
              dismiss(item.id);
            }
          }}
          className={cn(
            "rounded-card border-border bg-surface-2 shadow-surface-2 relative flex animate-[fade-in_200ms_var(--ease)] gap-3 border p-4 pr-9 max-md:gap-2.5 max-md:p-3 max-md:pr-8",
            "data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-full data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none",
            variantClasses[item.variant ?? "default"],
          )}
        >
          {item.icon ? <span className="mt-0.5 shrink-0">{item.icon}</span> : null}
          <div className="min-w-0 flex-1">
            {/* Компактный тост (заход «Мобильный тренажёр и тосты»): на мобильном
                заголовок и пояснение клампятся в одну строку каждое — тост
                перестаёт расти на пол-экрана и закрывать список под собой. */}
            <ToastPrimitive.Title className="text-text-1 flex items-start gap-2 text-[14px] font-medium max-md:text-[13px]">
              <span className="min-w-0 flex-1 max-md:line-clamp-1">{item.title}</span>
              {toastCountLabel(item.count) ? (
                <span
                  className="rounded-pill bg-border text-text-2 shrink-0 px-1.5 py-px text-[11px] font-semibold tabular-nums"
                  aria-label={`Повторов: ${item.count}`}
                >
                  {toastCountLabel(item.count)}
                </span>
              ) : null}
            </ToastPrimitive.Title>
            {item.description ? (
              <ToastPrimitive.Description className="text-text-2 text-[13px] max-md:line-clamp-1 max-md:text-[12px]">
                {item.description}
              </ToastPrimitive.Description>
            ) : null}
            {item.action ? (
              <ToastPrimitive.Action
                altText={item.action.label}
                onClick={item.action.onClick}
                className="text-accent ease-app hover:text-accent-hover mt-1.5 text-[13px] font-medium transition-colors duration-150"
              >
                {item.action.label}
              </ToastPrimitive.Action>
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
      {/* На мобильном вьюпорт стоит НАД BottomNav (56px + safe-area) и тянется
          по ширине экрана: два компактных тоста — потолок, поэтому нижняя
          навигация и кнопки действий под ними остаются видимыми (spec 13).
          No outline-none — the viewport is focusable via hotkey, spec 14 keeps rings visible. */}
      <ToastPrimitive.Viewport
        label="Уведомления ({hotkey})"
        className="fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 max-md:inset-x-3 max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-md:w-auto"
      />
    </ToastPrimitive.Provider>
  );
}

export { Toaster, toast, type ToastOptions, type ToastVariant };
