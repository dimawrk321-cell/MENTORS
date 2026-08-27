// Чистая арифметика сессии карточек (spec 7.6, заход C.8 «Сессия повторений v2»).
//
// Дека остаётся презентационной, а `ReviewSession` / `FreeSession` — клиентскими
// островками, поэтому счёт ритма, итогов порции и номера порции вынесен сюда:
// prisma в клиентский бандл из `lib/services/*` не утаскивается, а числа
// покрываются тестами (jsdom в проекте нет — см. шапку
// `tests/session-card-deck.test.tsx`).

export type SessionGrade = "again" | "hard" | "good";

/**
 * Порог, после которого ритм заменяется прежней сплошной полосой: на 20+
 * сегментах каждый тоньше волоса, и рисунок перестаёт читаться.
 *
 * Порция дневной очереди — min(SRS_SESSION_SIZE = 15, очередь), поэтому там
 * порог не срабатывает никогда; сработать он может только в свободной
 * тренировке с набором «все».
 */
export const DECK_RHYTHM_MAX_SEGMENTS = 20;

export interface SessionSummary {
  good: number;
  hard: number;
  again: number;
  /** Сколько карточек реально отвечено (может быть меньше размера порции). */
  answered: number;
}

export function summarizeGrades(grades: readonly SessionGrade[]): SessionSummary {
  const summary: SessionSummary = { good: 0, hard: 0, again: 0, answered: grades.length };
  for (const grade of grades) summary[grade] += 1;
  return summary;
}

/** Доля оценки в процентах; при нуле ответов — 0, а не деление на ноль. */
export function gradeSharePercent(count: number, answered: number): number {
  if (answered <= 0) return 0;
  return Math.round((count / answered) * 100);
}

export type RhythmSegment =
  { kind: "graded"; grade: SessionGrade } | { kind: "current" } | { kind: "todo" };

/**
 * Сегменты ритма: по одному на карточку порции.
 *
 * Оценка берётся по позиции — `grades[i]`; текущей считается позиция `index`,
 * но только пока дека принимает ввод (`active`): на экранах «Порция закрыта» и
 * «Готово» подсвечивать «текущую» карточку уже нечего.
 */
export function rhythmSegments(
  grades: readonly SessionGrade[],
  total: number,
  index: number,
  active: boolean,
): RhythmSegment[] {
  const segments: RhythmSegment[] = [];
  for (let i = 0; i < total; i += 1) {
    const grade = grades[i];
    if (grade) segments.push({ kind: "graded", grade });
    else if (active && i === index) segments.push({ kind: "current" });
    else segments.push({ kind: "todo" });
  }
  return segments;
}

/**
 * Пояснение режима под счётчиком дневной очереди (spec 7.6).
 *
 * Номер порции считается из уже отвеченного сегодня (`answeredToday` приходит
 * из `getSrsQueue`) и остатка очереди: закрытые сегодня порции — позади,
 * оставшиеся — впереди. Когда порция в очереди одна, номер не пишется вовсе:
 * «Порция 1 из 1» — шум, а не ориентир.
 */
export function sessionPortionNote(input: {
  answeredToday: number;
  /** Остаток дневной очереди на момент загрузки страницы, включая эту порцию. */
  queueTotal: number;
  portionSize: number;
}): string {
  const { answeredToday, queueTotal, portionSize } = input;
  const base = "дневная очередь";
  if (portionSize <= 0 || queueTotal <= 0) return base;
  const behind = Math.floor(Math.max(answeredToday, 0) / portionSize);
  const ahead = Math.ceil(queueTotal / portionSize);
  const total = behind + ahead;
  if (total <= 1) return base;
  return `Порция ${behind + 1} из ${total} · ${base}`;
}
