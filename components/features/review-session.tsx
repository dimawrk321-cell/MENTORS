"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Check, Eye, Flame, Layers, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { pluralRu } from "@/lib/utils/dates";
import { reviewCardAction } from "@/lib/actions/srs";
import { celebrateGamification } from "@/components/features/gamification-celebrate";
import {
  SessionCardDeck,
  useGradeOutcome,
  type DeckGrade,
} from "@/components/features/session-card-deck";
import { useViewOnly } from "@/components/features/view-only";
import { gradeSharePercent, summarizeGrades } from "@/lib/utils/session-summary";

// Сессия SRS (spec 7.6/13/14): полноэкранная карточка — категория, вопрос →
// «Показать ответ» (флип 250мс; reduced-motion — мгновенная смена) → эталон →
// «Не знаю / Сомневаюсь / Знаю». Свайпы: влево=again, вправо=good (вертикального
// свайпа-оценки нет — см. lib/utils/card-gesture.ts и уточнение 7.6 в ТЗ);
// клавиатура: Space — флип, 1/2/3 — оценки. Каждый ответ — отдельный action:
// выход в любой момент не теряет отвеченное.
//
// Сама карточка живёт в общей деке `SessionCardDeck` (её же использует
// свободная тренировка). Здесь остаётся то, что специфично для дневной
// очереди: грейд через reviewCardAction, ритм оценок, инлайн-подтверждение и
// экраны «Порция закрыта» / «Очередь закрыта» с итогами и пилюлями наград.

export interface SessionItem {
  cardId: string;
  sourceLabel: string;
  /** Ступень 0..5: на экране рисуется только «Новая карточка» при 0 (заход C.8). */
  step: number;
  category: { title: string; colorIndex: number };
  lesson: { id: string; title: string } | null;
  /** Вопрос простым текстом — компактная строка над раскрытым ответом. */
  questionText: string;
  questionNode: ReactNode;
  answerNode: ReactNode;
}

type Grade = DeckGrade;
type Phase = "cards" | "break" | "done";

export function ReviewSession({
  items,
  queueTotal,
  portionNote,
}: {
  items: SessionItem[];
  queueTotal: number;
  /** «Порция N из M · дневная очередь» — считает lib/utils/session-summary.ts. */
  portionNote: string;
}) {
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
  // Ритм и итоги считаются из ОДНОГО массива оценок (заход C.8): дека рисует
  // его сегментами, финальные экраны — числами, второго счёта нет.
  const [grades, setGrades] = useState<Grade[]>([]);
  // Инлайн-подтверждение вместо тоста «Следующее повторение — {дата}»: таймер
  // и его снятие живут в хуке, дека только рисует пришедшее.
  const { outcome, showOutcome, clearOutcome } = useGradeOutcome();
  // Награды для done-экрана — из результата грейда (без новых запросов): XP за
  // закрытие очереди и продление серии. Серию засчитывает событие queue.completed
  // (закрывающий грейд), поэтому streakCounted приходит именно с него.
  const [doneXp, setDoneXp] = useState(0);
  const [streakAdvanced, setStreakAdvanced] = useState(false);
  const [streakCurrent, setStreakCurrent] = useState(0);

  const item = items[index];
  const summary = summarizeGrades(grades);

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
      // Ритм копится и в режиме просмотра, чтобы ритуал был виден целиком.
      // DECISION: инлайн-подтверждение при этом НЕ показывается — «Записано»
      // было бы неправдой там, где на сервер не уходит ничего; про режим
      // говорят подтверждение выхода и финальный экран.
      setGrades((current) => [...current, value]);
      advance(remaining);
      return;
    }
    startTransition(async () => {
      const result = await reviewCardAction({ cardId: item.cardId, grade: value });
      if (!result.ok) {
        if (result.error.code === "not_due") {
          // Карточка уже учтена (двойной сабмит/устаревшая вкладка) — дальше.
          // Записи не было, поэтому и подтверждать нечего: полосу снимаем, иначе
          // она пережила бы переход к следующей карточке.
          clearOutcome();
          advance(remaining);
          return;
        }
        toast({ title: result.error.message, variant: "danger" });
        return;
      }
      setRemaining(result.data.remaining);
      setGrades((current) => [...current, value]);
      // Полоса показывается на СЛЕДУЮЩЕЙ карточке; на последней её место
      // занимает экран итогов, поэтому и показывать нечего.
      const next = items[index + 1];
      if (next) {
        showOutcome({
          grade: value,
          itemId: next.cardId,
          lessonId: item.lesson?.id ?? null,
        });
      } else {
        clearOutcome();
      }
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
        <GradeChips summary={summary} />
        <div className="flex gap-2">
          <Button loading={refreshing} onClick={() => startRefresh(() => router.refresh())}>
            Продолжить
          </Button>
          <Button asChild variant="secondary">
            <Link href="/trainer">Закончить</Link>
          </Button>
        </div>
        {/* Правда, а не утешение: каждый грейд — отдельный action, отвеченное
            уже в базе. В режиме просмотра на сервер не ушло ничего. */}
        {viewOnly ? (
          <ViewOnlyNote />
        ) : (
          <p className="text-text-3 text-[12.5px]">
            Отвеченное уже сохранено — можно выйти и вернуться позже.
          </p>
        )}
      </div>
    );
  }

  if (phase === "done") {
    // Экран «Очередь закрыта» (spec 7.6): +30 XP и день в серию начислены
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
          <p className="text-[20px] font-bold tracking-[-0.01em]">Очередь закрыта</p>
          <p className="text-text-2 mt-1.5 text-[14px]">
            {viewOnly
              ? "Так ученик увидит закрытую очередь."
              : "Сегодня всё повторено. Следующие карточки придут по расписанию."}
          </p>
        </div>
        {viewOnly && <ViewOnlyNote />}
        <SessionSummaryCard summary={summary} />
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
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="gradient">
            <Link href="/trainer">В тренажёр</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/trainer/free">Свободная тренировка</Link>
          </Button>
        </div>
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
      grades={grades}
      step={item.step}
      sourceLabel={item.sourceLabel}
      flipped={flipped}
      pending={pending}
      active={phase === "cards"}
      exitHref="/trainer"
      exitLabel="Закончить"
      note={portionNote}
      outcome={outcome}
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

function ViewOnlyNote() {
  return (
    <p className="text-text-3 flex items-start gap-1.5 text-[13px]">
      <Eye size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>Режим просмотра: ответы не записаны, расписание не изменилось.</span>
    </p>
  );
}

const TONES = [
  { key: "good", label: "Знаю", color: "var(--success)" },
  { key: "hard", label: "Сомневаюсь", color: "var(--warning)" },
  { key: "again", label: "Не знаю", color: "var(--danger)" },
] as const;

/** Итоги порции чипами (заход C.8): те же оценки, что рисуют ритм. */
function GradeChips({ summary }: { summary: ReturnType<typeof summarizeGrades> }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {TONES.map((tone) => (
        <span
          key={tone.key}
          className="rounded-pill border-border bg-surface-1 text-text-2 inline-flex items-center gap-[7px] border px-3 py-1 text-[12.5px]"
        >
          <span
            aria-hidden="true"
            className="size-[7px] rounded-full"
            style={{ background: tone.color }}
          />
          {tone.label} · <span className="tabular-nums">{summary[tone.key]}</span>
        </span>
      ))}
    </div>
  );
}

/** «Как прошла сессия» (заход C.8): доля «Знаю», полоса, легенда и вывод. Без дат. */
function SessionSummaryCard({ summary }: { summary: ReturnType<typeof summarizeGrades> }) {
  if (summary.answered === 0) return null;
  const share = (count: number) => `${gradeSharePercent(count, summary.answered)}%`;

  return (
    <Card className="w-full max-w-[460px] rounded-[16px] px-5 py-4.5 text-left">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-text-3 text-[13px]">Как прошла сессия</p>
        <p className="text-text-3 text-[13px] tabular-nums">{share(summary.good)} «Знаю»</p>
      </div>
      <div
        className="rounded-pill mt-3 flex h-2 overflow-hidden"
        style={{ background: "var(--heat-empty)" }}
        aria-hidden="true"
      >
        {TONES.map((tone) => (
          <span
            key={tone.key}
            style={{ width: share(summary[tone.key]), background: tone.color }}
          />
        ))}
      </div>
      <div className="text-text-2 mt-2.5 flex flex-wrap gap-3 text-[12.5px]">
        {TONES.map((tone) => (
          <span key={tone.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-[2px]"
              style={{ background: tone.color }}
            />
            {tone.label} <span className="tabular-nums">{summary[tone.key]}</span>
          </span>
        ))}
      </div>
      <p className="border-border text-text-2 mt-3.5 border-t pt-3 text-[13px]">
        {summary.again > 0
          ? "Карточки с «Не знаю» вернутся ещё раз — они же подсветятся в западающих темах."
          : "Ни одного «Не знаю» — колода двигается дальше по интервалам."}
      </p>
    </Card>
  );
}
