"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { BookOpen, RotateCw } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryChip } from "@/components/features/category-chip";
import { cn } from "@/lib/utils/cn";

// Презентационная дека карточек (spec 7.6/13/14) — общая для дневной очереди
// (ReviewSession) и свободной тренировки (FreeSession).
//
// Вынесена ИЗ review-session.tsx дословно: разметка, классы, тексты, пороги
// свайпа и раскладка клавиш перенесены как есть. Режимы отличаются только тем,
// что происходит ПОСЛЕ оценки, — это остаётся в вызывающих компонентах, а
// внешний вид и ввод у них общие и не могут разъехаться.
//
// /trainer/session — ежедневный ритуал: любое отличие поведения здесь считается
// регрессом, поэтому дека не знает ни про SRS, ни про прогон и не принимает
// решений — только рисует и зовёт onGrade/onFlip.

export interface DeckItem {
  /** Ключ перемонтирования граней: cardId в очереди, questionId в прогоне. */
  id: string;
  category: { title: string; colorIndex: number };
  lesson: { id: string; title: string } | null;
  questionNode: ReactNode;
  answerNode: ReactNode;
}

export type DeckGrade = "again" | "hard" | "good";

const SWIPE_THRESHOLD_PX = 60;

export function SessionCardDeck({
  item,
  index,
  total,
  flipped,
  pending,
  active,
  exitHref,
  exitLabel,
  exitConfirm,
  onFlip,
  onGrade,
}: {
  item: DeckItem;
  index: number;
  total: number;
  flipped: boolean;
  pending: boolean;
  /** Дека принимает ввод только пока идёт показ карточек (не на break/done). */
  active: boolean;
  exitHref: string;
  exitLabel: string;
  exitConfirm: string;
  onFlip: (next: boolean) => void;
  onGrade: (grade: DeckGrade) => void;
}) {
  const touchStart = useRef<{ x: number; y: number; scrollY: number } | null>(null);

  function grade(value: DeckGrade): void {
    if (!flipped || pending || !active) return;
    onGrade(value);
  }

  // Слушатель клавиатуры вешается один раз и читает свежее состояние из рефа.
  // Раньше эффект пересоздавался по списку зависимостей — при выносе деки это
  // стало бы источником устаревших замыканий (`onGrade` меняется каждый рендер).
  const latest = useRef({ flipped, pending, active, onFlip, onGrade });
  latest.current = { flipped, pending, active, onFlip, onGrade };

  // Клавиатура (spec 14): Space — флип, 1/2/3 — оценки.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const state = latest.current;
      if (!state.active) return;
      // Не перехватываем Space/цифры у сфокусированного контрола — пусть кнопка
      // или ссылка активируется штатно (spec 14: полная клавиатурная навигация).
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select")) return;
      if (event.code === "Space") {
        event.preventDefault();
        state.onFlip(!state.flipped);
        return;
      }
      const key = event.key;
      if (key !== "1" && key !== "2" && key !== "3") return;
      if (!state.flipped || state.pending) return;
      state.onGrade(key === "1" ? "again" : key === "2" ? "hard" : "good");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-text-2 text-[13px]" aria-live="polite">
          {index + 1} / {total}
        </p>
        {/* Hierarchical exit with confirm (spec 12.1/C7). */}
        <BackButton href={exitHref} label={exitLabel} confirmMessage={exitConfirm} />
      </div>

      <div
        className="rounded-pill bg-border h-1 w-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round((index / total) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Прогресс сессии"
      >
        <div
          className="ease-app h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${Math.round((index / total) * 100)}%`,
            backgroundImage: "var(--gradient-accent)",
          }}
        />
      </div>

      <div>
        <CategoryChip title={item.category.title} colorIndex={item.category.colorIndex} />
      </div>

      {/* Флип-карточка: свайпы по открытому ответу = оценки (spec 7.6). */}
      <div
        className="relative [perspective:1200px]"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStart.current = touch
            ? { x: touch.clientX, y: touch.clientY, scrollY: window.scrollY }
            : null;
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          if (!start || !flipped || pending) return;
          // Если за жест страница проскроллилась — это скролл длинного ответа,
          // а не свайп-оценка: не даём вертикальному скроллу ставить «hard».
          if (Math.abs(window.scrollY - start.scrollY) > 8) return;
          const touch = event.changedTouches[0];
          if (!touch) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) >= Math.abs(dy)) {
            if (dx <= -SWIPE_THRESHOLD_PX) grade("again");
            else if (dx >= SWIPE_THRESHOLD_PX) grade("good");
          } else if (dy >= SWIPE_THRESHOLD_PX) {
            grade("hard");
          }
        }}
      >
        {/* key по карточке: переход к следующей монтирует грани заново на
            rotateY(0), без анимации разворота (иначе мелькнул бы ответ). */}
        {/* Spec 5.4: reduced-motion — флип заменяется мгновенной сменой. */}
        <div
          key={item.id}
          className="ease-app relative grid transition-transform duration-250 [transform-style:preserve-3d] motion-reduce:transition-none"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {/* inert на неактивной грани убирает её из фокуса и дерева
              доступности — backface-visibility прячет только визуально. */}
          <div className="col-start-1 row-start-1 [backface-visibility:hidden]" inert={flipped}>
            <Card className="min-h-[280px]">
              <CardContent className="p-6">
                <p className="text-text-3 mb-3 text-[12px] font-medium tracking-wide uppercase">
                  Вопрос
                </p>
                <div className="lesson-prose text-[17px]">{item.questionNode}</div>
              </CardContent>
            </Card>
          </div>
          <div
            className="col-start-1 row-start-1 [transform:rotateY(180deg)] [backface-visibility:hidden]"
            inert={!flipped}
          >
            <Card className="min-h-[280px]">
              <CardContent className="p-6">
                <p className="text-text-3 mb-3 text-[12px] font-medium tracking-wide uppercase">
                  Эталонный ответ
                </p>
                <div className="lesson-prose text-[15px]">{item.answerNode}</div>
                {item.lesson && (
                  <Link
                    href={`/lessons/${item.lesson.id}`}
                    className="text-accent hover:text-accent-hover mt-4 flex w-fit items-center gap-1.5 text-[13px]"
                  >
                    <BookOpen size={14} strokeWidth={1.75} aria-hidden="true" />
                    Открыть урок: {item.lesson.title}
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Оценки внизу, тач-зоны ≥44px (spec 13); sticky над BottomNav на мобильном. */}
      <div className="bg-bg sticky bottom-0 z-10 flex flex-col gap-2 py-2 md:static md:bg-transparent md:py-0">
        {flipped ? (
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Оценка карточки">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => grade("again")}
              className={cn("text-danger min-h-11")}
            >
              Не знаю
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => grade("hard")}
              className={cn("text-warning min-h-11")}
            >
              Сомневаюсь
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => grade("good")}
              className={cn("text-success min-h-11")}
            >
              Знаю
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="min-h-11" onClick={() => onFlip(true)}>
            <RotateCw size={15} strokeWidth={1.75} aria-hidden="true" />
            Показать ответ
          </Button>
        )}
        <p className="text-text-3 hidden text-center text-[12px] md:block">
          Space — ответ · 1 / 2 / 3 — оценки · свайпы на мобильном
        </p>
      </div>
    </div>
  );
}
