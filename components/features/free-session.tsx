"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { Check, Eye, Layers, Sparkles, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { CategoryChip } from "@/components/features/category-chip";
import { SessionCardDeck, type DeckGrade } from "@/components/features/session-card-deck";
import { useViewOnly } from "@/components/features/view-only";
import { finishFreeTrainingAction } from "@/lib/actions/free-training";
import type { FreeTrainingResult } from "@/lib/services/free-training";
import { summarizeFreeTraining, type FreeTrainingRoot } from "@/lib/utils/free-training-summary";
import { pluralRu } from "@/lib/utils/dates";

// Свободная тренировка (заход «Банк вопросов», блок B). Карточки рисует общая
// дека `SessionCardDeck` — та же, что в дневной очереди; отличается только то,
// что происходит после оценки: здесь ответы копятся локально и уходят одной
// пачкой в конце (прерванный прогон не оставляет следа), а вместо «Готово!» с
// наградами показывается разбор.

export interface FreeSessionItem {
  questionId: string;
  category: { title: string; colorIndex: number };
  /** Корневая категория — по ней строится разбор «слабых тем». */
  root: FreeTrainingRoot;
  lesson: { id: string; title: string } | null;
  /** Вопрос простым текстом — компактная строка над раскрытым ответом. */
  questionText: string;
  questionNode: ReactNode;
  answerNode: ReactNode;
}

export function FreeSession({
  items,
  setupHref,
}: {
  items: FreeSessionItem[];
  /** Куда возвращает «Другой набор» — с сохранёнными параметрами прогона. */
  setupHref: string;
}) {
  const viewOnly = useViewOnly();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [answers, setAnswers] = useState<{ questionId: string; grade: DeckGrade }[]>([]);
  const [result, setResult] = useState<FreeTrainingResult | null>(null);
  const [pending, startTransition] = useTransition();

  const item = items[index];

  function finishLocally(answered: { questionId: string; grade: DeckGrade }[]): void {
    // «Глазами ученика»: итог считаем тем же кодом, что и сервер, но ничего не
    // пишем — ни карточек SRS, ни событий (spec 7.2).
    const roots = new Map(items.map((entry) => [entry.questionId, entry.root]));
    setResult({ ...summarizeFreeTraining(answered, roots), addedToSrs: 0 });
  }

  function celebrate(): void {
    try {
      navigator.vibrate?.(10);
    } catch {
      // Vibration API недоступен — тихо пропускаем.
    }
  }

  function grade(value: DeckGrade): void {
    if (!item || pending || result) return;
    const next = [...answers, { questionId: item.questionId, grade: value }];
    setAnswers(next);
    if (index + 1 < items.length) {
      setIndex(index + 1);
      setFlipped(false);
      return;
    }
    if (viewOnly) {
      finishLocally(next);
      celebrate();
      return;
    }
    startTransition(async () => {
      const res = await finishFreeTrainingAction({ answers: next });
      if (!res) return;
      if (!res.ok) {
        toast({ title: res.error.message, variant: "danger" });
        return;
      }
      setResult(res.data);
      celebrate();
    });
  }

  if (result) {
    return (
      <FreeResult result={result} setupHref={setupHref} total={items.length} viewOnly={viewOnly} />
    );
  }
  if (!item) return null;

  return (
    <SessionCardDeck
      item={{
        id: item.questionId,
        category: item.category,
        lesson: item.lesson,
        questionText: item.questionText,
        questionNode: item.questionNode,
        answerNode: item.answerNode,
      }}
      index={index}
      total={items.length}
      flipped={flipped}
      pending={pending}
      active={!result}
      exitHref="/trainer"
      exitLabel="Закончить"
      // Прогон засчитывается целиком в конце, поэтому выход теряет его весь —
      // текст подтверждения об этом честно предупреждает. В режиме просмотра
      // засчитывать нечего, теряется только разбор.
      exitConfirm={
        viewOnly
          ? "Разбор прогона не будет показан. Прервать свободную тренировку?"
          : "Прогон не будет засчитан. Прервать свободную тренировку?"
      }
      onFlip={setFlipped}
      onGrade={grade}
    />
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-[24px] font-bold tabular-nums ${tone}`}>{value}</span>
      <span className="text-text-3 text-[12px]">{label}</span>
    </div>
  );
}

function FreeResult({
  result,
  setupHref,
  total,
  viewOnly,
}: {
  result: FreeTrainingResult;
  setupHref: string;
  total: number;
  viewOnly: boolean;
}) {
  const weak = result.byCategory.filter((row) => row.missed > 0);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 py-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="flex size-14 items-center justify-center rounded-full"
          style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
        >
          <Check size={26} strokeWidth={2} className="text-accent" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[20px] font-bold tracking-[-0.01em]">Прогон закончен</p>
          <p className="text-text-2 mt-1.5 text-[14px]">
            {total} {pluralRu(total, "вопрос", "вопроса", "вопросов")} · это тренировка, поэтому XP
            и серия не начисляются.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex items-center justify-around p-5">
          <Stat value={result.good} label="Знал" tone="text-success" />
          <Stat value={result.hard} label="Сомневался" tone="text-warning" />
          <Stat value={result.again} label="Не знал" tone="text-danger" />
        </CardContent>
      </Card>

      {viewOnly ? (
        <p className="rounded-control border-border bg-surface-1 text-text-2 flex items-start gap-2 border px-3.5 py-2.5 text-[13px]">
          <Eye size={15} strokeWidth={1.75} className="text-text-3 mt-0.5 shrink-0" />
          <span>Режим просмотра: карточки в повторения не добавлены.</span>
        </p>
      ) : (
        result.addedToSrs > 0 && (
          <p className="rounded-control border-accent/30 bg-accent/8 text-text-2 flex items-start gap-2 border px-3.5 py-2.5 text-[13px]">
            <Sparkles size={15} strokeWidth={1.75} className="text-accent mt-0.5 shrink-0" />
            <span>
              В повторения добавлено{" "}
              <span className="text-text-1 tabular-nums">{result.addedToSrs}</span>{" "}
              {pluralRu(result.addedToSrs, "карточка", "карточки", "карточек")} — вернутся в очередь
              по расписанию.
            </span>
          </p>
        )
      )}

      {weak.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-text-3 flex items-center gap-2 text-[13px] font-semibold tracking-[0.08em] uppercase">
            <TrendingDown size={14} strokeWidth={1.75} aria-hidden="true" />
            Слабые темы
          </h2>
          <div className="flex flex-col gap-1.5">
            {weak.map((row) => (
              <div
                key={row.categoryId}
                className="rounded-control border-border bg-surface-1 flex items-center justify-between gap-3 border px-3.5 py-2.5"
              >
                <CategoryChip title={row.title} colorIndex={row.colorIndex} />
                <span className="text-text-2 shrink-0 text-[13px] tabular-nums">
                  {row.missed} из {row.total} мимо
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {result.weakQuestionIds.length > 0 && (
          <Button asChild>
            <Link href={`${setupHref}&repeat=${result.weakQuestionIds.join(",")}`}>
              Повторить слабые
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link href="/trainer/session">
            <Layers size={15} strokeWidth={1.75} aria-hidden="true" />В повторения
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/trainer">В тренажёр</Link>
        </Button>
      </div>
    </div>
  );
}
