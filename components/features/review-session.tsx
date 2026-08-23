"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Check, Eye, Flame, Layers, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDateOnlyRu, pluralRu } from "@/lib/utils/dates";
import { reviewCardAction } from "@/lib/actions/srs";
import { celebrateGamification } from "@/components/features/gamification-celebrate";
import { SessionCardDeck, type DeckGrade } from "@/components/features/session-card-deck";
import { useViewOnly } from "@/components/features/view-only";

// Сессия SRS (spec 7.6/13/14): полноэкранная карточка — категория, вопрос →
// «Показать ответ» (флип 250мс; reduced-motion — мгновенная смена) → эталон →
// «Не знаю / Сомневаюсь / Знаю». Свайпы: влево=again, вправо=good (вертикального
// свайпа-оценки нет — см. lib/utils/card-gesture.ts и уточнение 7.6 в ТЗ);
// клавиатура: Space — флип, 1/2/3 — оценки. Каждый ответ — отдельный action:
// выход в любой момент не теряет отвеченное.
//
// Сама карточка живёт в общей деке `SessionCardDeck` (её же использует
// свободная тренировка). Здесь остаётся то, что специфично для дневной
// очереди: грейд через reviewCardAction, экран «Порция закрыта» и «Готово» с
// пилюлями наград.

export interface SessionItem {
  cardId: string;
  sourceLabel: string;
  category: { title: string; colorIndex: number };
  lesson: { id: string; title: string } | null;
  /** Вопрос простым текстом — компактная строка над раскрытым ответом. */
  questionText: string;
  questionNode: ReactNode;
  answerNode: ReactNode;
}

type Grade = DeckGrade;
type Phase = "cards" | "break" | "done";

export function ReviewSession({ items, queueTotal }: { items: SessionItem[]; queueTotal: number }) {
  const router = useRouter();
  // «Глазами ученика»: карточки листаются, но ни один грейд не уходит на сервер
  // (spec 7.2). Ритуал показывается целиком — иначе ментор упирался бы в отказ
  // на первой же карточке и не видел ни экрана «Готово», ни «Порция закрыта».
  const viewOnly = useViewOnly();
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
    if (viewOnly) {
      advance(remaining);
      return;
    }
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
      toast({
        title: "Следующее повторение",
        description: formatDateOnlyRu(new Date(result.data.nextReviewAt)),
      });
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
            {viewOnly
              ? "Так ученик увидит закрытую очередь."
              : "Очередь на сегодня закрыта. Следующие карточки придут по расписанию."}
          </p>
        </div>
        {viewOnly && (
          <p className="text-text-3 flex items-start gap-1.5 text-[13px]">
            <Eye size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Режим просмотра: ответы не записаны, расписание не изменилось.</span>
          </p>
        )}
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
    <SessionCardDeck
      item={{
        id: item.cardId,
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
      active={phase === "cards"}
      exitHref="/trainer"
      exitLabel="Закончить"
      note={item.sourceLabel}
      // Отвеченные карточки уже сохранены (каждый грейд — свой action), теряется
      // только неотвеченный остаток (spec 12.1/C7). В режиме просмотра не
      // сохраняется ничего, и обещать сохранность нельзя.
      exitConfirm={
        viewOnly
          ? "Режим просмотра: ответы не сохраняются. Прервать сессию повторений?"
          : "Прогресс отвеченных сохранён. Прервать сессию повторений?"
      }
      onFlip={setFlipped}
      onGrade={grade}
    />
  );
}
