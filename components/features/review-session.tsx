"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { BookOpen, Check, Flame, Layers, RotateCw, Sparkles } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryChip } from "@/components/features/category-chip";
import { toast } from "@/components/ui/toast";
import { pluralRu } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { reviewCardAction } from "@/lib/actions/srs";
import { celebrateGamification } from "@/components/features/gamification-celebrate";

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
  // Награды для done-экрана — из результата грейда (без новых запросов): XP за
  // закрытие очереди и продление серии. Серию засчитывает событие queue.completed
  // (закрывающий грейд), поэтому streakCounted приходит именно с него.
  const [doneXp, setDoneXp] = useState(0);
  const [streakAdvanced, setStreakAdvanced] = useState(false);
  const [streakCurrent, setStreakCurrent] = useState(0);
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
      // Серия продлевается на первом качественном событии дня — копим флаг за сессию.
      if (result.data.streakCounted) {
        setStreakAdvanced(true);
        setStreakCurrent(result.data.streakCurrent);
      }
      if (result.data.queueCompleted) {
        // На шаге закрытия очереди награды показываем пилюлями на done-экране —
        // тосты этого шага убраны, чтобы не дублировать (по решению владельца).
        setDoneXp(result.data.gamification.xpAwarded);
      } else {
        // Ритуалы: toast за достижения (напр. cards_100) и новый уровень (spec 5.4).
        celebrateGamification(result.data.gamification);
      }
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
        <div
          className="flex size-14 items-center justify-center rounded-full"
          style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
        >
          <Layers size={26} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[18px] font-semibold">Порция закрыта</p>
          <p className="text-text-2 mt-1.5 text-[14px]">
            Осталось ещё {remaining} {pluralRu(remaining, "карточка", "карточки", "карточек")} —
            продолжить?
          </p>
        </div>
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
    // Сдержанный экран «Готово» (spec 7.6): +30 XP и день в серию начислены
    // диспетчером; достижения/уровень уже показаны тостами.
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-10 text-center">
        <div
          className="flex size-18 items-center justify-center rounded-full"
          style={{
            backgroundImage: "var(--gradient-accent)",
            boxShadow: "0 0 32px color-mix(in srgb, var(--violet) 40%, transparent)",
          }}
        >
          <Check size={30} strokeWidth={2.25} className="text-white" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[20px] font-bold tracking-[-0.01em]">Готово!</p>
          <p className="text-text-2 mt-1.5 text-[14px]">
            Очередь на сегодня закрыта. Следующие карточки придут по расписанию.
          </p>
        </div>
        {/* Пилюли наград (design handoff): XP за закрытие очереди + продление серии,
            если день ещё не был засчитан. Значения — из результата грейда. */}
        {(doneXp > 0 || streakAdvanced) && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {doneXp > 0 && (
              <span className="rounded-pill bg-success/12 text-success inline-flex items-center gap-1.5 px-3 py-[5px] text-[13px] font-medium">
                <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" />+{doneXp} XP
              </span>
            )}
            {streakAdvanced && (
              <span className="rounded-pill border-accent/30 bg-accent/10 inline-flex items-center gap-1.5 border px-3 py-[5px] text-[13px] font-medium">
                <Flame size={14} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
                Серия продлена: {streakCurrent} {pluralRu(streakCurrent, "день", "дня", "дней")}
              </span>
            )}
          </div>
        )}
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
        {/* Hierarchical exit with confirm (spec 12.1/C7): answered cards are already
            saved (each grade is its own action), so only the in-progress rest is lost. */}
        <BackButton
          href="/trainer"
          label="Закончить"
          confirmMessage="Прогресс отвеченных сохранён. Прервать сессию повторений?"
        />
      </div>

      <div
        className="rounded-pill bg-border h-1 w-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round((index / items.length) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Прогресс сессии"
      >
        <div
          className="ease-app h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${Math.round((index / items.length) * 100)}%`,
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
          key={item.cardId}
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
