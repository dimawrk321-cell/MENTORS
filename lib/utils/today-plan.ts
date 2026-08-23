export type TodayPlanKind = "mock" | "srs" | "lesson" | "weak" | "courses";

export interface TodayPlanItem {
  kind: TodayPlanKind;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
}

export interface TodayPlan {
  primary: TodayPlanItem;
  secondary: TodayPlanItem[];
}

export function buildTodayPlan(input: {
  nowMs: number;
  mock?: { bookingId: string; startsAtMs: number; endsAtMs: number; whenLabel: string } | null;
  queue?: { total: number; estimateMinutes: number } | null;
  lesson?: { id: string; title: string; mode: "continue" | "start" } | null;
  weak?: { categoryId: string; title: string; againShare: number } | null;
}): TodayPlan {
  const candidates: TodayPlanItem[] = [];
  const inNextDay = input.nowMs + 24 * 60 * 60 * 1000;
  if (input.mock && input.mock.endsAtMs > input.nowMs && input.mock.startsAtMs <= inNextDay) {
    candidates.push({
      kind: "mock",
      title: "Подготовься к мок-интервью",
      description: input.mock.whenLabel,
      href: `/mocks/${input.mock.bookingId}`,
      actionLabel: "Открыть мок",
    });
  }
  if (input.queue && input.queue.total > 0) {
    candidates.push({
      kind: "srs",
      title: "Закрой очередь повторений",
      description: `${input.queue.total} карточек · около ${input.queue.estimateMinutes} мин`,
      href: "/trainer/session",
      actionLabel: "Начать повторение",
    });
  }
  if (input.lesson) {
    candidates.push({
      kind: "lesson",
      title: input.lesson.mode === "continue" ? "Продолжи текущий урок" : "Начни следующий урок",
      description: input.lesson.title,
      href: `/lessons/${input.lesson.id}`,
      actionLabel: input.lesson.mode === "continue" ? "Продолжить" : "Начать урок",
    });
  }
  if (input.weak) {
    candidates.push({
      kind: "weak",
      title: `Подтяни тему «${input.weak.title}»`,
      description: `${Math.round(input.weak.againShare * 100)}% ответов «Не знаю» за 30 дней`,
      href: `/trainer/free/run?source=category&id=${encodeURIComponent(input.weak.categoryId)}&size=15`,
      actionLabel: "Потренировать тему",
    });
  }
  candidates.push({
    kind: "courses",
    title: "Выбери следующий урок",
    description: "Продолжи обучение по программе PRIME",
    href: "/courses",
    actionLabel: "Открыть курсы",
  });

  return { primary: candidates[0]!, secondary: candidates.slice(1, 3) };
}
