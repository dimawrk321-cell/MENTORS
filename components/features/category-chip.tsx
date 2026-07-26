import { cn } from "@/lib/utils/cn";
import { categoryLabelStyle } from "@/lib/utils/category-color";

// Category label chip (walk 13.5 block 1.5): the one place a category name renders
// as a tinted pill — catalog sections, the question card, the dashboard «западающие».
// Long names truncate with an ellipsis and carry a native `title` tooltip with the
// full name, so a wide category can never burst its container (owner's screenshot bug).

export function CategoryChip({
  title,
  colorIndex,
  prefix,
  className,
}: {
  title: string;
  colorIndex: number;
  /** Родительская категория для подписи «Родитель · Тема» (карточка вопроса). */
  prefix?: string | null;
  className?: string;
}) {
  const full = prefix ? `${prefix} · ${title}` : title;
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
