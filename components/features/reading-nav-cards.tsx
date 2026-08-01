import Link from "next/link";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Карточки «Предыдущая/Следующая» внизу читального экрана («Читалка v2»).
// Заблокированный следующий шаг — карточка с замком, не ссылка и не кликается:
// гейтинг урока (spec 7.3) и жёсткая цепь курсов (changelog 13.6, блок 2v2)
// решают доступность НА СЕРВЕРЕ, здесь только честное отображение результата.

export interface ReadingNavItem {
  href: string;
  title: string;
  /** Подпись-кикер: «Предыдущий урок», «Следующая глава», … */
  kicker: string;
  /** Закрыт гейтингом — рендерится замок, ссылки нет. */
  locked?: boolean;
  /** Почему закрыт; показывается вместо заголовка-ссылки. */
  lockHint?: string;
}

function Body({ item, direction }: { item: ReadingNavItem; direction: "prev" | "next" }) {
  const Arrow = direction === "prev" ? ArrowLeft : ArrowRight;
  const Icon = item.locked ? Lock : Arrow;
  return (
    <>
      <span
        className={cn(
          "text-text-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase",
          direction === "next" && "justify-end",
        )}
      >
        {direction === "prev" && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
        {item.kicker}
        {direction === "next" && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
      </span>
      <span
        className={cn(
          "text-[15px] font-medium",
          direction === "next" && "text-right",
          item.locked ? "text-text-3" : "text-text-1 group-hover:text-accent",
        )}
      >
        {item.title}
      </span>
      {item.locked && item.lockHint && (
        <span className={cn("text-text-3 text-[12px]", direction === "next" && "text-right")}>
          {item.lockHint}
        </span>
      )}
    </>
  );
}

const CARD =
  "rounded-card border-border bg-surface-1 shadow-card flex min-w-0 flex-col gap-1 border p-4";

function Card({
  item,
  direction,
  className,
}: {
  item: ReadingNavItem;
  direction: "prev" | "next";
  className?: string;
}) {
  if (item.locked) {
    return (
      <div aria-disabled="true" className={cn(CARD, "opacity-70", className)}>
        <Body item={item} direction={direction} />
      </div>
    );
  }
  return (
    <Link
      href={item.href}
      className={cn(
        CARD,
        "group ease-app hover:border-border-strong transition-[transform,border-color] duration-150 hover:-translate-y-px",
        className,
      )}
    >
      <Body item={item} direction={direction} />
    </Link>
  );
}

export function ReadingNavCards({
  prev,
  next,
  className,
}: {
  prev: ReadingNavItem | null;
  next: ReadingNavItem | null;
  className?: string;
}) {
  if (!prev && !next) return null;
  return (
    <nav aria-label="Навигация по материалу" className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {prev && <Card item={prev} direction="prev" />}
      {/* Первый шаг: единственная карточка «дальше» держится правой колонки. */}
      {next && (
        <Card item={next} direction="next" className={!prev ? "sm:col-start-2" : undefined} />
      )}
    </nav>
  );
}
