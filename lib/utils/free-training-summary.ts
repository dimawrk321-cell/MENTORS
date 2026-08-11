// Подсчёт итога свободной тренировки — чистый, без БД.
//
// Живёт в utils, а не в сервисе, намеренно: тот же подсчёт нужен клиенту в
// режиме «Глазами ученика», где прогон доходит до итога, но ничего не пишется.
// Импорт значения из `lib/services/free-training` утащил бы в клиентский бандл
// весь серверный модуль вместе с prisma (грабля из stage 10), поэтому общая
// чистая часть вынесена сюда, а сервис её переиспользует и реэкспортирует типы.

export type FreeTrainingGrade = "again" | "hard" | "good";

export interface FreeTrainingAnswer {
  questionId: string;
  grade: FreeTrainingGrade;
}

/** Корневая категория вопроса — разбор итога делается по корням, не по темам. */
export interface FreeTrainingRoot {
  id: string;
  title: string;
  colorIndex: number;
}

export interface FreeTrainingCategoryRow {
  categoryId: string;
  title: string;
  colorIndex: number;
  total: number;
  missed: number;
}

export interface FreeTrainingSummary {
  good: number;
  hard: number;
  again: number;
  /** Разбивка по корневым категориям, худшие сверху. */
  byCategory: FreeTrainingCategoryRow[];
  /** Вопросы, которые стоит прогнать ещё раз («Повторить слабые»). */
  weakQuestionIds: string[];
}

export function summarizeFreeTraining(
  answers: readonly FreeTrainingAnswer[],
  rootByQuestion: ReadonlyMap<string, FreeTrainingRoot>,
): FreeTrainingSummary {
  const groups = new Map<string, FreeTrainingCategoryRow>();
  const weakQuestionIds: string[] = [];

  for (const answer of answers) {
    if (answer.grade !== "good") weakQuestionIds.push(answer.questionId);

    const root = rootByQuestion.get(answer.questionId);
    // Вопрос мог исчезнуть между сбором набора и итогом — счётчики оценок его
    // всё равно учитывают, в разбор по темам он просто не попадает.
    if (!root) continue;
    const group = groups.get(root.id) ?? {
      categoryId: root.id,
      title: root.title,
      colorIndex: root.colorIndex,
      total: 0,
      missed: 0,
    };
    group.total += 1;
    if (answer.grade !== "good") group.missed += 1;
    groups.set(root.id, group);
  }

  return {
    good: answers.filter((a) => a.grade === "good").length,
    hard: answers.filter((a) => a.grade === "hard").length,
    again: answers.filter((a) => a.grade === "again").length,
    byCategory: [...groups.values()].sort(
      (a, b) => b.missed - a.missed || b.total - a.total || a.title.localeCompare(b.title),
    ),
    weakQuestionIds,
  };
}
