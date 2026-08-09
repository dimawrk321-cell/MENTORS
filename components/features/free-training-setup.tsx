"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BookOpen, Layers, Play, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { pluralRu } from "@/lib/utils/dates";
import type { FreeTrainingSources } from "@/lib/services/free-training";

// Настройка свободного прогона (заход «Банк вопросов», B2). Наборы приходят уже
// отфильтрованными по цепи курсов — здесь только выбор.

const SIZES = [10, 15, 20, "all"] as const;
type Size = (typeof SIZES)[number];

type Pick =
  | { kind: "category"; id: string; title: string; questions: number }
  | { kind: "course"; id: string; title: string; questions: number }
  | { kind: "lagging"; id: "lagging"; title: string; questions: number };

function OptionRow({
  option,
  active,
  icon: Icon,
  onPick,
}: {
  option: Pick;
  active: boolean;
  icon: typeof BookOpen;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={cn(
        "rounded-control ease-app flex min-h-11 items-center gap-2.5 border px-3.5 py-2.5 text-left transition-colors duration-150",
        active
          ? "border-accent bg-accent/8"
          : "border-border hover:border-border-strong bg-surface-1",
      )}
    >
      <Icon
        size={15}
        strokeWidth={1.75}
        className={cn("shrink-0", active ? "text-accent" : "text-text-3")}
        aria-hidden="true"
      />
      <span className="text-text-1 min-w-0 flex-1 truncate text-[14px]">{option.title}</span>
      <span className="text-text-3 shrink-0 text-[12px] tabular-nums">{option.questions}</span>
    </button>
  );
}

export function FreeTrainingSetup({ sources }: { sources: FreeTrainingSources }) {
  const router = useRouter();
  const [pick, setPick] = useState<Pick | null>(null);
  const [size, setSize] = useState<Size>(15);
  const [navigating, startNavigation] = useTransition();

  const available = pick ? pick.questions : 0;
  // Размер больше набора не ошибка, но и не обещание: показываем честное число.
  const willRun = size === "all" ? available : Math.min(size, available);

  function start(): void {
    if (!pick) return;
    const params = new URLSearchParams({ source: pick.kind, size: String(size) });
    if (pick.kind !== "lagging") params.set("id", pick.id);
    startNavigation(() => router.push(`/trainer/free/run?${params.toString()}`));
  }

  const nothing =
    sources.categories.length === 0 && sources.courses.length === 0 && sources.lagging === 0;

  if (nothing) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-text-2 text-[14px]">
            Пока нечего тренировать: вопросы открываются вместе с курсами. Пройди первый курс — и
            здесь появятся наборы.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="text-text-3 text-[13px] font-semibold tracking-[0.08em] uppercase">
          Что тренируем
        </h2>
        <div role="radiogroup" aria-label="Набор вопросов" className="flex flex-col gap-3">
          {sources.lagging > 0 && (
            <OptionRow
              option={{
                kind: "lagging",
                id: "lagging",
                title: "Мои западающие",
                questions: sources.lagging,
              }}
              active={pick?.kind === "lagging"}
              icon={TrendingDown}
              onPick={() =>
                setPick({
                  kind: "lagging",
                  id: "lagging",
                  title: "Мои западающие",
                  questions: sources.lagging,
                })
              }
            />
          )}

          {sources.courses.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-text-3 text-[12px]">По курсу</span>
              {sources.courses.map((course) => (
                <OptionRow
                  key={course.id}
                  option={{ kind: "course", ...course }}
                  active={pick?.kind === "course" && pick.id === course.id}
                  icon={BookOpen}
                  onPick={() => setPick({ kind: "course", ...course })}
                />
              ))}
            </div>
          )}

          {sources.categories.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-text-3 text-[12px]">По категории</span>
              {sources.categories.map((category) => (
                <OptionRow
                  key={category.id}
                  option={{ kind: "category", ...category }}
                  active={pick?.kind === "category" && pick.id === category.id}
                  icon={Layers}
                  onPick={() => setPick({ kind: "category", ...category })}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-text-3 text-[13px] font-semibold tracking-[0.08em] uppercase">
          Сколько вопросов
        </h2>
        <div role="radiogroup" aria-label="Размер прогона" className="flex flex-wrap gap-2">
          {SIZES.map((value) => (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={size === value}
              onClick={() => setSize(value)}
              className={cn(
                "rounded-pill ease-app min-h-11 border px-4 text-[14px] transition-colors duration-150 md:min-h-9",
                size === value
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-text-2 hover:border-border-strong",
              )}
            >
              {value === "all" ? "Все" : value}
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="gradient" disabled={!pick} loading={navigating} onClick={start}>
          <Play size={15} strokeWidth={1.75} aria-hidden="true" />
          Начать
        </Button>
        {pick && (
          <span className="text-text-3 text-[13px] tabular-nums">
            {willRun} {pluralRu(willRun, "вопрос", "вопроса", "вопросов")} из набора «{pick.title}»
          </span>
        )}
      </div>
    </div>
  );
}
