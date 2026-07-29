import { cn } from "@/lib/utils/cn";
import { categoryColorVar, categoryLabelStyle } from "@/lib/utils/category-color";

// Category label chip (design handoff). Two variants:
//  • "dot" (default) — neutral surface-2 bordered pill with a leading colour dot and
//    default text; used in lists (catalog sections, «западающие», trainer, session).
//  • "tinted" — the colour-tinted pill (12% bg + coloured text); used on the flip-card.
// Long names truncate with an ellipsis and carry a native `title` tooltip.

export function CategoryChip({
  title,
  colorIndex,
  prefix,
  variant = "dot",
  className,
}: {
  title: string;
  colorIndex: number;
  /** Родительская категория для подписи «Родитель · Тема». */
  prefix?: string | null;
  variant?: "dot" | "tinted";
  className?: string;
}) {
  const full = prefix ? `${prefix} · ${title}` : title;

  if (variant === "tinted") {
    return (
      <span
        title={full}
        style={categoryLabelStyle(colorIndex)}
        className={cn(
          "rounded-pill inline-block max-w-[11rem] truncate px-2.5 py-[3px] align-middle text-[12px] font-medium sm:max-w-[16rem]",
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
        "rounded-pill border-border bg-surface-2 text-text-1 inline-flex max-w-[13rem] items-center gap-2 border px-2.5 py-[3px] text-[12px] font-medium",
        className,
      )}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: categoryColorVar(colorIndex) }}
        aria-hidden="true"
      />
      <span className="truncate">{full}</span>
    </span>
  );
}
