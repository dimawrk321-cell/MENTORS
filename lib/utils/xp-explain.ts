import { XP_MAP_KEYS, XP_MAP_LABEL, type XpMap, type XpMapKey } from "@/lib/services/xp";
import { STREAK_QUALIFYING_EVENTS } from "@/lib/services/streak";

// Объяснение геймификации ученику (заход B.2, блок 1).
//
// Жалоба учеников: непонятно, что нужно сделать, чтобы день засчитался.
//
// ВАЖНО ПО ФАКТУ: день в серии и дневная цель — РАЗНЫЕ механизмы, и это самое
// главное, что нужно объяснить.
//   • День серии засчитывает ЛЮБОЕ качественное событие из
//     `STREAK_QUALIFYING_EVENTS` (spec 7.7) — один ответ в квизе уже закрывает
//     день. Набирать цель для этого НЕ нужно.
//   • Дневная цель — отдельная шкала: XP за сегодня против `daily_goal_xp`.
//
// Поэтому оба списка ниже СТРОЯТСЯ ИЗ ТЕХ ЖЕ ИСТОЧНИКОВ, что и сама механика:
// значения — из карты XP (`getXpMap`, app_settings-first), а список «что
// засчитывает день» — из `STREAK_QUALIFYING_EVENTS`. Подписи привязаны к тем же
// ключам, и тест падает, если у события из множества не оказалось подписи, —
// добавить событие в механику и забыть про объяснение нельзя.

export interface XpRow {
  key: XpMapKey;
  label: string;
  amount: number;
  /** Уточнение «за что именно» — разовость по spec 7.7. */
  note: string;
}

/** Разовость начисления (spec 7.7, колонка «Правило разовости»). */
const XP_NOTE: Record<XpMapKey, string> = {
  "lesson.completed": "один раз за урок",
  "quiz.correct_first": "за первый верный ответ на вопрос",
  "test.passed": "один раз за модуль",
  "test.passed_first_try": "если сдал с первой попытки",
  "testout.passed": "один раз за модуль",
  "queue.completed": "один раз в день",
  "mock.completed": "за проведённый мок",
  "streak.milestone.7": "на седьмой день серии",
  "streak.milestone.30": "на тридцатый день серии",
  "streak.milestone.100": "на сотый день серии",
};

/** Таблица «за что даётся XP» — значения из настроек платформы, не из вёрстки. */
export function xpRows(map: XpMap): XpRow[] {
  return XP_MAP_KEYS.map((key) => ({
    key,
    label: XP_MAP_LABEL[key],
    amount: map[key],
    note: XP_NOTE[key],
  }));
}

/** Человеческие подписи событий, засчитывающих учебный день (spec 7.7). */
const DAY_EVENT_LABEL: Record<string, string> = {
  "lesson.completed": "завершил урок",
  "quiz.answered": "ответил хотя бы на один вопрос квиза",
  // passed и failed — две записи механики, но для ученика это одна мысль:
  // засчитывается сама попытка, а не её исход. Подписи совпадают, и дедуп в
  // dayCountingLabels() сливает их в одну строку.
  "test.passed": "прошёл попытку модульного теста — даже неудачную",
  "test.failed": "прошёл попытку модульного теста — даже неудачную",
  "testout.passed": "сдал модуль экстерном",
  "queue.completed": "закрыл очередь повторений",
};

/**
 * Что засчитывает учебный день — ровно множество `STREAK_QUALIFYING_EVENTS`.
 * Попытки теста (passed/failed) сливаются в одну строку: ученику важно, что
 * засчитывается сама попытка, а не её исход.
 */
export function dayCountingLabels(): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const event of STREAK_QUALIFYING_EVENTS) {
    const label = DAY_EVENT_LABEL[event];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

/** У каждого события из механики есть подпись — иначе объяснение врёт молчанием. */
export function missingDayEventLabels(): string[] {
  return [...STREAK_QUALIFYING_EVENTS].filter((event) => !DAY_EVENT_LABEL[event]);
}

export interface GoalProgress {
  /** XP за сегодня (TZ ученика). */
  today: number;
  /** Дневная цель ученика (`daily_goal_xp`). */
  goal: number;
  /** Сколько ещё набрать; 0 — цель закрыта. */
  remaining: number;
  closed: boolean;
}

/** Прогресс дневной цели. Второго определения «сколько осталось» в вёрстке нет. */
export function goalProgress(todayXp: number, goal: number): GoalProgress {
  const safeGoal = Math.max(0, goal);
  const remaining = Math.max(0, safeGoal - todayXp);
  return { today: todayXp, goal: safeGoal, remaining, closed: safeGoal > 0 && remaining === 0 };
}

/**
 * Чем добрать цель: самые дешёвые понятные действия с реальными числами.
 * Вехи серии и первая попытка теста сюда не идут — их нельзя «сделать сейчас».
 */
const TOP_UP_KEYS: XpMapKey[] = ["queue.completed", "lesson.completed", "quiz.correct_first"];

export function topUpHints(map: XpMap): XpRow[] {
  return xpRows(map).filter((row) => TOP_UP_KEYS.includes(row.key) && row.amount > 0);
}
