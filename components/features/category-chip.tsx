import { cn } from "@/lib/utils/cn";
import { categoryColorVar, categoryLabelStyle } from "@/lib/utils/category-color";

// Category label chip (design handoff). Two variants:
//  • "dot" (default) — neutral surface-2 bordered pill with a leading colour dot and
//    default text; used in lists (catalog sections, «западающие», trainer, session).
//  • "tinted" — the colour-tinted pill (12% bg + coloured text); used on the flip-card.
// Long names truncate with an ellipsis and carry a native `title` tooltip.
//
// `wrap` (заход B.4) отменяет и обрезку, и потолок ширины: в шапке сессии
// тренажёра метка стоит одна на своей строке, обрезать её нечем — «Параллелизм
// и асинхронн…» теряет ровно ту половину, ради которой метку и читают, а
// `title`-тултип на телефоне недоступен. В списках обрезка остаётся: там метка
// делит строку с другими элементами.

export function CategoryChip({
  title,
  colorIndex,
  prefix,
  variant = "dot",
  wrap = false,
  className,
}: {
  title: string;
  colorIndex: number;
  /** Родительская категория для подписи «Родитель · Тема». */
  prefix?: string | null;
  variant?: "dot" | "tinted";
  /** Полное имя в несколько строк вместо многоточия (шапка сессии). */
  wrap?: boolean;
  className?: string;
}) {
  const full = prefix ? `${prefix} · ${title}` : title;

  if (variant === "tinted") {
    return (
      <span
        title={full}
        style={categoryLabelStyle(colorIndex)}
        className={cn(
          "rounded-pill px-2.5 py-[3px] align-middle text-[12px] font-medium",
          wrap ? "inline-block max-w-full" : "inline-block max-w-[11rem] truncate sm:max-w-[16rem]",
          className,
        )}
      >
        {full}
      </span>
    );
  }

  return (
    <span
      title={full}
      className={cn(
        "rounded-pill border-border bg-surface-2 text-text-1 inline-flex gap-2 border px-2.5 py-[3px] text-[12px] font-medium",
        wrap ? "max-w-full items-start" : "max-w-[13rem] items-center",
        className,
      )}
    >
      <span
        className={cn("size-2 shrink-0 rounded-full", wrap && "mt-[5px]")}
        style={{ background: categoryColorVar(colorIndex) }}
        aria-hidden="true"
      />
      <span className={cn(wrap ? "min-w-0" : "truncate")}>{full}</span>
    </span>
  );
}
