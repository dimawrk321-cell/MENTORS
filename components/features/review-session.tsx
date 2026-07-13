"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { BookOpen, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { pluralRu } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { categoryColorVar } from "@/lib/utils/category-color";
import { reviewCardAction } from "@/lib/actions/srs";

// Сессия SRS (spec 7.6/13/14): полноэкранная карточка — категория, вопрос →
// «Показать ответ» (флип 250мс; reduced-motion — мгновенная смена) → эталон →
// «Не знаю / Сомневаюсь / Знаю». Свайпы: влево=again, вниз=hard, вправо=good;
// клавиатура: Space — флип, 1/2/3 — оценки. Каждый ответ — отдельный action:
// выход в любой момент не теряет отвеченное.

export interface SessionItem {
  cardId: string;
  category: { title: string; colorIndex: number };
  lesson: { id: string; title: string } | null;
  questionNode: ReactNode;
  answerNode: ReactNode;
}

type Grade = "again" | "hard" | "good";
type Phase = "cards" | "break" | "done";

const SWIPE_THRESHOLD_PX = 60;

export function ReviewSession({ items, queueTotal }: { items: SessionItem[]; queueTotal: number }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [phase, setPhase] = useState<Phase>("cards");
  const [remaining, setRemaining] = useState(queueTotal - items.length);
  const [pending, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const touchStart = useRef<{ x: number; y: number; scrollY: number } | null>(null);

  const item = items[index];

  function advance(remainingAfter: number): void {
    if (index + 1 < items.length) {
      setIndex(index + 1);
      setFlipped(false);
      return;
    }
    setPhase(remainingAfter > 0 ? "break" : "done");
  }

  function grade(value: Grade): void {
    if (!item || !flipped || pending || phase !== "cards") return;
    startTransition(async () => {
      const result = await reviewCardAction({ cardId: item.cardId, grade: value });
      if (!result.ok) {
        if (result.error.code === "not_due") {
          // Карточка уже учтена (двойной сабмит/устаревшая вкладка) — дальше.
          advance(remaining);
          return;
        }
        toast({ title: result.error.message, variant: "danger" });
        return;
      }
      setRemaining(result.data.remaining);
      advance(result.data.remaining);
    });
  }

  // Клавиатура (spec 14): Space — флип, 1/2/3 — оценки.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (phase !== "cards") return;
      // Не перехватываем Space/цифры у сфокусированного контрола — пусть кнопка
      // или ссылка активируется штатно (spec 14: полная клавиатурная навигация).
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setFlipped((value) => !value);
        return;
      }
      if (event.key === "1") grade("again");
      if (event.key === "2") grade("hard");
      if (event.key === "3") grade("good");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, flipped, pending, index, remaining]);

  // Haptic на закрытии очереди (spec 13).
  useEffect(() => {
    if (phase === "done") {
      try {
        navigator.vibrate?.(10);
      } catch {
        // Vibration API недоступен — тихо пропускаем.
      }
    }
  }, [phase]);

  if (phase === "break") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-10 text-center">
        <p className="text-[18px] font-semibold">Порция закрыта</p>
        <p className="text-text-2 text-[14px]">
          Осталось ещё {remaining} {pluralRu(remaining, "карточка", "карточки", "карточек")} —
          продолжить?
        </p>
        <div className="flex gap-2">
          <Button loading={refreshing} onClick={() => startRefresh(() => router.refresh())}>
            Продолжить
          </Button>
          <Button asChild variant="secondary">
            <Link href="/trainer">Закончить</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    // Сдержанный экран «Готово» (spec 7.6); XP-строка появится на этапе 5.
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-10 text-center">
        <div className="rounded-pill border-border bg-surface-2 flex size-12 items-center justify-center border">
          <Check size={22} strokeWidth={1.75} className="text-success" aria-hidden="true" />
        </div>
        <p className="text-[18px] font-semibold">Готово</p>
        <p className="text-text-2 text-[14px]">
          Очередь на сегодня закрыта. Следующие карточки придут по расписанию.
        </p>
        <Button asChild variant="secondary">
          <Link href="/trainer">В тренажёр</Link>
        </Button>
      </div>
    );
  }

  if (!item) return null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-text-2 text-[13px]" aria-live="polite">
          {index + 1} / {items.length}
        </p>
        <Link
          href="/trainer"
          className="text-text-3 ease-app hover:text-text-1 flex items-center gap-1.5 text-[13px] transition-colors duration-150"
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
          Закончить
        </Link>
      </div>

      <div>
        <Badge
          style={{
            color: categoryColorVar(item.category.colorIndex),
            background: `color-mix(in srgb, ${categoryColorVar(item.category.colorIndex)} 12%, transparent)`,
          }}
        >
          {item.category.title}
        </Badge>
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
          key={item.cardId}
          className="ease-app relative grid transition-transform duration-250 [transform-style:preserve-3d] motion-reduce:transition-none"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {/* inert на неактивной грани убирает её из фокуса и дерева
              доступности — backface-visibility прячет только визуально. */}
          <div className="col-start-1 row-start-1 [backface-visibility:hidden]" inert={flipped}>
            <Card className="min-h-[280px]">
              <CardContent className="lesson-prose p-6 text-[16px]">
                {item.questionNode}
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
      <div className="bg-bg sticky bottom-16 z-10 flex flex-col gap-2 py-2 md:static md:bg-transparent md:py-0">
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
          <Button variant="secondary" className="min-h-11" onClick={() => setFlipped(true)}>
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
