import type { HeatmapData } from "@/lib/services/dashboard";

// Счётные функции вкладки «Обзор» в профиле (заход C.8 «Профиль по референсу v2»).
//
// Вынесены из вёрстки по той же причине, что и `xp-explain`: числа, которые
// ученик читает как утверждение о себе, должны иметь ровно одно определение и
// тест. Здесь только арифметика — запросы живут в сервисах.

export interface CourseLessonCounts {
  lessonsCompleted: number;
  lessonsTotal: number;
}

export interface LessonTotals {
  completed: number;
  total: number;
  /** 0..100, округление вниз до целого; 0 при пустой программе. */
  pct: number;
}

/**
 * Суммарный прогресс по программе из тех же строк, которыми нарисованы карточки
 * курсов на дашборде (`listCoursesForStudent`). Знаменатель — обязательные уроки
 * курса (`state.totalRequired`), поэтому «49%» в профиле и проценты на курсах
 * считаются от одного и того же.
 */
export function lessonTotals(rows: CourseLessonCounts[]): LessonTotals {
  let completed = 0;
  let total = 0;
  for (const row of rows) {
    completed += row.lessonsCompleted;
    total += row.lessonsTotal;
  }
  return { completed, total, pct: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

/**
 * Сколько дней в сетке активности были непустыми. Будущие ячейки текущей недели
 * не считаются — они и не отрисованы.
 */
export function heatmapActiveDays(data: HeatmapData): number {
  let days = 0;
  for (const column of data.columns) {
    for (const cell of column) {
      if (!cell.future && cell.total > 0) days += 1;
    }
  }
  return days;
}

/**
 * Цвет полосы темы по точности ответов (референс «Профиль v2», блок «Темы»).
 * Только существующие токены (spec 5.1), хардкода цветов нет.
 */
export function accuracyColorVar(accuracyPct: number): string {
  if (accuracyPct >= 80) return "var(--success)";
  if (accuracyPct >= 55) return "var(--cat-5)";
  if (accuracyPct >= 35) return "var(--warning)";
  return "var(--danger)";
}
