import type { ReactNode } from "react";
import { Lightbulb, Paperclip, Star, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Врезки контента (spec 5.3, 4 типа: совет `--accent` / важное `--warning` /
// предупреждение `--danger` / материал `--text-2`).
//
// «Читалка v2»: врезка стала КАРТОЧКОЙ с шапкой (иконка + название типа) —
// граница в тон 35%, фон 6%, радиус 12px, как в дизайн-хендоффе и в прототипах
// («Врезки (callout): границы/фон color-mix(<tone> 35% / 6–8%), radius 10–12px»).
// Прежняя полоса слева 2px из исходной формулировки 5.3 снята: хендофф и
// высокоточные прототипы — более поздний источник.
//
// НОВЫХ ТИПОВ НЕ ВВОДИТСЯ: редактор 13.6 вставляет ровно эти четыре директивы,
// формат хранения и путь рендера не меняются (принцип «zero drift» раздела 8.5).
type CalloutType = "tip" | "important" | "warning" | "material";

const CALLOUT_TYPES = ["tip", "important", "warning", "material"] as const;

interface CalloutMeta {
  label: string;
  icon: LucideIcon;
  /** Рамка/фон/цвет шапки — статичные классы, чтобы их видел сканер Tailwind. */
  frame: string;
  ink: string;
}

const META: Record<CalloutType, CalloutMeta> = {
  tip: {
    label: "Совет",
    icon: Lightbulb,
    frame: "border-accent/35 bg-accent/6",
    // accent-ink, а не text-accent: 11px акцентом не берёт 4.5 в тёмной теме
    // (globals.css осветляет его так же, как ссылки контента).
    ink: "accent-ink",
  },
  important: {
    label: "Важно",
    icon: Star,
    frame: "border-warning/35 bg-warning/6",
    ink: "text-warning",
  },
  warning: {
    label: "Предупреждение",
    icon: TriangleAlert,
    frame: "border-danger/35 bg-danger/6",
    ink: "text-danger",
  },
  material: {
    label: "Материалы",
    icon: Paperclip,
    frame: "border-border bg-text-2/6",
    ink: "text-text-2",
  },
};

export function Callout({ type, children }: { type?: string; children?: ReactNode }) {
  const resolved: CalloutType = CALLOUT_TYPES.includes(type as CalloutType)
    ? (type as CalloutType)
    : "tip";
  const meta = META[resolved];
  const Icon = meta.icon;

  return (
    <aside className={cn("lesson-callout my-5 rounded-[12px] border px-4 py-3.5", meta.frame)}>
      <div
        className={cn(
          "mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] uppercase",
          meta.ink,
        )}
      >
        <Icon size={14} strokeWidth={2} aria-hidden="true" />
        {meta.label}
      </div>
      {resolved === "material" ? <MaterialGrid>{children}</MaterialGrid> : children}
    </aside>
  );
}

/**
 * Lays external-material link cards out as a wrapping card grid (walk 12.3, P3c).
 * `display:contents` on the wrapping paragraphs/lists lets the cards become direct
 * flex items so they flow into columns; prose and human-labelled links flow too.
 */
export function MaterialGrid({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 [&_li]:contents [&_ol]:contents [&_p]:contents [&_ul]:contents">
      {children}
    </div>
  );
}
