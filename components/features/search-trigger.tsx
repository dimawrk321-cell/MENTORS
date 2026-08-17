"use client";

import { Search } from "lucide-react";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/features/command-palette";
import { cn } from "@/lib/utils/cn";

// Opens the CommandPalette (spec 5.3/7.11). Decoupled from the palette via a
// window event so the trigger can live in a sidebar/header while the palette is
// mounted once in the layout.

function openPalette(): void {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

/**
 * Desktop sidebar row: label + «⌘K» hint (spec 7.11 integration).
 *
 * `labelClassName` вешается на подпись и на подсказку клавиши — всё, что
 * исчезает, когда строка схлопывается в иконку. Студенческий сайдбар передаёт
 * сюда свой `student-sidebar-label`, и правило рельса (globals.css, заход B.3)
 * гасит подпись поиска тем же селектором, что подписи пунктов навигации.
 */
export function SearchTriggerBar({
  className,
  labelClassName,
  onClick,
  ...rest
}: React.ComponentProps<"button"> & { labelClassName?: string }) {
  return (
    <button
      type="button"
      // Остальные props прокидываются, чтобы кнопку можно было отдать в
      // `TooltipTrigger asChild` (рельс сайдбара, заход B.3): Radix передаёт
      // сюда ref и свои указательные обработчики. Свой onClick составной, а не
      // затирающий, — иначе один из двух перестал бы работать.
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) openPalette();
      }}
      aria-label="Поиск"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "rounded-control border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 flex h-9 items-center gap-2 border px-3 text-[13px] transition-colors duration-150",
        className,
      )}
    >
      <Search size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      <span className={cn("flex-1 text-left", labelClassName)}>Поиск</span>
      {/* Hint hidden on the narrow tablet rail (md), back on lg. */}
      <kbd
        className={cn(
          "border-border text-text-3 hidden rounded border px-1 text-[11px] lg:inline",
          labelClassName,
        )}
      >
        ⌘K
      </kbd>
    </button>
  );
}

/** Icon-only trigger for mobile headers (touch zone ≥44px, spec 13). */
export function SearchTriggerIcon({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Поиск"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "text-text-2 ease-app hover:text-text-1 flex size-11 items-center justify-center transition-colors duration-150",
        className,
      )}
    >
      <Search size={20} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
