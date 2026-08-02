"use client";

import { useState } from "react";
import { ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useReadingTracker } from "@/components/features/reading-tracker";
import { cn } from "@/lib/utils/cn";
import { buildToc, readingPercent, type ReadingHeading } from "@/lib/utils/reading";

// Оглавление читального экрана (урок и гайд — один компонент, «Читалка v2»):
// липкая колонка справа со scroll-spy и процентом прочитанного на ≥1264px,
// Sheet-шторка ниже. Активный раздел и процент берутся из общего хука через
// ReadingTracker — второго слушателя скролла на странице нет.
//
// Уровень вложенности пункта считается по САМОМУ ВЕРХНЕМУ уровню заголовков
// документа, а не строго по H2: импортированный контент сплошь и рядом
// структурирован H3 (63 из 85 уроков базы вообще без H2), и жёсткая привязка к
// H2 сплющила бы оглавление (см. lib/utils/reading.ts).
//
// Порядковых номеров у пунктов НЕТ (решение владельца): импортированные
// заголовки почти все пронумерованы руками прямо в тексте — «1. Базовый
// минимум…», — и автонумерация давала вторую поверх первой.

// Оглавление живёт рядом с колонкой только когда для него есть место на ВСЕХ
// участников сразу: 240 (сайдбар зоны) + 64 (поля) + 680 (текст) + 40 (зазор) +
// 224 (оглавление) = 1248, плюс ~16px на классический скроллбар — медиазапросы
// Chrome меряют ширину ВМЕСТЕ с ним, а раскладке достаётся уже без него. Отсюда
// 1264: ровно на этой ширине читальная колонка ещё держит свои 680. На пороге
// пониже она СУЖАЛАСЬ бы в момент появления оглавления, то есть текст ужимался
// бы от расширения окна. Ниже 1264 оглавление уходит в шторку, а колонка просто
// центрируется — пустого столбца не остаётся.
// Брейкпоинт написан литералами (`min-[1264px]:…`) во всех местах намеренно:
// сканер Tailwind v4 читает исходник как текст и склеенный из переменной класс
// не увидит. Тот же литерал стоит в скелетах загрузки обоих экранов и в
// `GuidesNav` (сайдбар разделов схлопывается там, где встаёт оглавление).

function TocLinks({
  headings,
  activeId,
  onNavigate,
}: {
  headings: readonly ReadingHeading[];
  activeId: string | null;
  onNavigate?: () => void;
}) {
  const entries = buildToc(headings);
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) => {
        const active = entry.id === activeId;
        return (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              onClick={onNavigate}
              aria-current={active ? "location" : undefined}
              className={cn(
                "ease-app block border-l-2 py-1.5 pr-1 text-[13px] break-words transition-colors duration-150",
                entry.isSection ? "pl-3" : "pl-6 text-[12.5px]",
                active
                  ? "border-l-accent text-text-1"
                  : "border-l-border text-text-3 hover:text-text-1",
              )}
            >
              {entry.text}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function ReadCounter({ className }: { className?: string }) {
  const { fraction } = useReadingTracker();
  const percent = readingPercent(fraction);
  return (
    <div className={cn("border-border border-t pt-3", className)}>
      <ProgressBar value={percent} gradient className="h-1" aria-label="Прочитано" />
      <p className="text-text-3 mt-1.5 text-[11px] tabular-nums">Прочитано {percent}%</p>
    </div>
  );
}

export function LessonTocRail({
  headings,
  title = "В этом уроке",
}: {
  headings: ReadingHeading[];
  title?: string;
}) {
  const { activeId } = useReadingTracker();
  // Материал без заголовков оглавления не получает — но колонку СОХРАНЯЕТ пустой
  // и невидимой: иначе читальная колонка прыгала бы по горизонтали при переходе
  // между соседними главами раздела (одна с заголовками, другая без).
  if (headings.length < 2) {
    return <aside aria-hidden="true" className="hidden w-56 shrink-0 min-[1264px]:block" />;
  }
  return (
    <aside className="sticky top-[76px] hidden max-h-[calc(100dvh-7rem)] w-56 shrink-0 flex-col self-start min-[1264px]:flex">
      <p className="text-text-3 mb-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
        {title}
      </p>
      <nav aria-label={title} className="min-h-0 flex-1 overflow-y-auto">
        <TocLinks headings={headings} activeId={activeId} />
      </nav>
      <ReadCounter className="mt-3" />
    </aside>
  );
}

export function LessonTocSheet({
  headings,
  title = "В этом уроке",
}: {
  headings: ReadingHeading[];
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const { activeId } = useReadingTracker();
  if (headings.length < 2) return null;

  return (
    <div className="min-[1264px]:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="secondary" size="sm">
            <ListTree size={15} strokeWidth={1.75} aria-hidden="true" />
            Оглавление
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>{title}</SheetTitle>
          <nav aria-label={title}>
            <TocLinks headings={headings} activeId={activeId} onNavigate={() => setOpen(false)} />
          </nav>
          <ReadCounter className="mt-4" />
        </SheetContent>
      </Sheet>
    </div>
  );
}
