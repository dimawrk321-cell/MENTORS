import type { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import { dateOnlyUtc, localDateStr } from "@/lib/utils/dates";

// XP, уровни и XP-карта (spec 7.7). Начисление идёт только через диспетчер
// событий (spec 7.13, lib/services/events.ts) — этот модуль даёт чистые правила
// (карта, формула уровней) и агрегаторы (сумма всего / за день в TZ). Ни один
// другой модуль не пишет xp_events напрямую.

// --- Уровни (spec 7.7): xp_to_next(L) = round(100 × 1.15^(L−1)), кумулятивно ---

/** XP-порог перехода с уровня L на L+1 (spec 7.7). */
export function xpToNext(level: number): number {
  return Math.round(100 * Math.pow(1.15, level - 1));
}

/** Кумулятивный XP, необходимый чтобы достичь уровня L (L1 = 0). */
export function cumulativeXpForLevel(level: number): number {
  let sum = 0;
  for (let k = 1; k < level; k += 1) sum += xpToNext(k);
  return sum;
}

export interface LevelInfo {
  level: number;
  /** Кумулятивный XP в начале текущего уровня. */
  levelFloor: number;
  /** Кумулятивный XP на входе в следующий уровень. */
  nextLevelAt: number;
  /** XP, набранный внутри текущего уровня. */
  intoLevel: number;
  /** Размах текущего уровня в XP. */
  levelSpan: number;
  /** Прогресс 0..1 до следующего уровня. */
  progress: number;
  /** Сколько XP осталось до следующего уровня. */
  toNext: number;
}

/** Уровень и прогресс по суммарному XP (spec 7.7). */
export function levelForXp(totalXp: number): LevelInfo {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  // Уровни растут медленно; цикл сходится за десятки итераций даже для больших XP.
  while (cumulativeXpForLevel(level + 1) <= xp) level += 1;
  const levelFloor = cumulativeXpForLevel(level);
  const nextLevelAt = cumulativeXpForLevel(level + 1);
  const levelSpan = nextLevelAt - levelFloor;
  const intoLevel = xp - levelFloor;
  return {
    level,
    levelFloor,
    nextLevelAt,
    intoLevel,
    levelSpan,
    progress: levelSpan === 0 ? 0 : intoLevel / levelSpan,
    toNext: nextLevelAt - xp,
  };
}

// --- XP-карта (spec 7.7, дословно) ---

/** Разовое начисление XP: type + сумма + идемпотентный ref (всегда непустой). */
export interface XpAward {
  xpType: string;
  amount: number;
  refType: string;
  refId: string;
}

// --- XP-карта: редактируемая величина (spec 12.1/C1) ---
//
// Суммы XP-карты 7.7 живут код-константой `DEFAULT_XP_MAP`, но админ может
// переопределить каждую в /admin/settings (app_settings-first: `getXpMap` в
// settings.ts читает ключ `xp_map`, валидирует int 0–10000 по каждому полю и
// фоллбэчит на дефолт). `xpAwardsForEvent`/`planXp` принимают карту параметром —
// диспетчер событий грузит актуальную карту и передаёт её сюда; без параметра
// (юнит-тесты) применяется дефолт.

/** Ключи XP-карты (события XP 7.7 + вехи стрика). Порядок = порядок в редакторе. */
export const XP_MAP_KEYS = [
  "lesson.completed",
  "quiz.correct_first",
  "test.passed",
  "test.passed_first_try",
  "testout.passed",
  "queue.completed",
  "mock.completed",
  "streak.milestone.7",
  "streak.milestone.30",
  "streak.milestone.100",
] as const;

export type XpMapKey = (typeof XP_MAP_KEYS)[number];
export type XpMap = Record<XpMapKey, number>;

/** Дефолтная XP-карта (spec 7.7, дословно). Фоллбэк для отсутствующих настроек. */
export const DEFAULT_XP_MAP: XpMap = {
  "lesson.completed": 20,
  "quiz.correct_first": 5,
  "test.passed": 100,
  "test.passed_first_try": 50,
  "testout.passed": 100,
  "queue.completed": 30,
  "mock.completed": 200,
  "streak.milestone.7": 50,
  "streak.milestone.30": 250,
  "streak.milestone.100": 1000,
};

/** Границы значения XP-события (spec 12.1/C1: целое 0–10000). */
export const XP_VALUE_MIN = 0;
export const XP_VALUE_MAX = 10000;

/** Русские подписи для редактора XP-карты. */
export const XP_MAP_LABEL: Record<XpMapKey, string> = {
  "lesson.completed": "Урок завершён",
  "quiz.correct_first": "Первый верный ответ в квизе",
  "test.passed": "Модульный тест сдан",
  "test.passed_first_try": "Тест сдан с первой попытки",
  "testout.passed": "Экстерн сдан",
  "queue.completed": "Очередь повторений закрыта",
  "mock.completed": "Мок проведён",
  "streak.milestone.7": "Веха серии: 7 дней",
  "streak.milestone.30": "Веха серии: 30 дней",
  "streak.milestone.100": "Веха серии: 100 дней",
};

/**
 * События, у которых первое начисление — «первичное»: его ref дедуплицирует
 * ВСЁ событие (реплей — no-op). Барьер exactly-once строится на нём (spec 7.13):
 * INSERT ... ON CONFLICT DO NOTHING по уникальному индексу xp_events. Остальные
 * события (quiz.answered, streak.milestone) логируются на каждое появление, а их
 * начисления идемпотентны по собственному ref.
 */
const PRIMARY_REF_EVENTS = new Set([
  "lesson.completed",
  "test.passed",
  "testout.passed",
  "queue.completed",
  "mock.completed",
]);

function pickString(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function pickNumber(payload: unknown, key: string): number | null {
  if (payload && typeof payload === "object" && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
  }
  return null;
}

/** Все XP-начисления события по карте 7.7, в порядке (первичное — первым). */
export function xpAwardsForEvent(
  type: string,
  payload: unknown,
  xpMap: XpMap = DEFAULT_XP_MAP,
): XpAward[] {
  switch (type) {
    case "lesson.completed": {
      const lessonId = pickString(payload, "lessonId");
      return lessonId
        ? [
            {
              xpType: "lesson.completed",
              amount: xpMap["lesson.completed"],
              refType: "lesson",
              refId: lessonId,
            },
          ]
        : [];
    }
    case "quiz.answered": {
      // +5 только за первый правильный ответ на вопрос (spec 7.5); ref — вопрос.
      const first =
        payload &&
        typeof payload === "object" &&
        (payload as Record<string, unknown>).first === true;
      const questionId = pickString(payload, "questionId");
      return first && questionId
        ? [
            {
              xpType: "quiz.correct_first",
              amount: xpMap["quiz.correct_first"],
              refType: "question",
              refId: questionId,
            },
          ]
        : [];
    }
    case "test.passed": {
      // Только модульный тест (kind=module); test-out даёт свой testout.passed.
      if (pickString(payload, "kind") !== "module") return [];
      const moduleId = pickString(payload, "moduleId");
      if (!moduleId) return [];
      const awards: XpAward[] = [
        { xpType: "test.passed", amount: xpMap["test.passed"], refType: "module", refId: moduleId },
      ];
      if (pickNumber(payload, "attemptNumber") === 1) {
        awards.push({
          xpType: "test.passed_first_try",
          amount: xpMap["test.passed_first_try"],
          refType: "module",
          refId: moduleId,
        });
      }
      return awards;
    }
    case "testout.passed": {
      const moduleId = pickString(payload, "moduleId");
      return moduleId
        ? [
            {
              xpType: "testout.passed",
              amount: xpMap["testout.passed"],
              refType: "module",
              refId: moduleId,
            },
          ]
        : [];
    }
    case "queue.completed": {
      const day = pickString(payload, "day");
      return day
        ? [
            {
              xpType: "queue.completed",
              amount: xpMap["queue.completed"],
              refType: "day",
              refId: day,
            },
          ]
        : [];
    }
    case "mock.completed": {
      const bookingId = pickString(payload, "bookingId");
      return bookingId
        ? [
            {
              xpType: "mock.completed",
              amount: xpMap["mock.completed"],
              refType: "booking",
              refId: bookingId,
            },
          ]
        : [];
    }
    case "streak.milestone": {
      const milestone = pickNumber(payload, "milestone");
      const key = `streak.milestone.${milestone}`;
      const amount =
        milestone !== null && (XP_MAP_KEYS as readonly string[]).includes(key)
          ? xpMap[key as XpMapKey]
          : undefined;
      return milestone !== null && amount !== undefined
        ? [{ xpType: "streak.milestone", amount, refType: "milestone", refId: String(milestone) }]
        : [];
    }
    default:
      return [];
  }
}

export interface XpPlan {
  /** Барьер идемпотентности всего события (null — событие логируется всегда). */
  primary: XpAward | null;
  /** Остальные начисления (идемпотентны по собственному ref). */
  secondary: XpAward[];
}

/** Раскладывает начисления события на первичное (барьер) и вторичные. */
export function planXp(type: string, payload: unknown, xpMap: XpMap = DEFAULT_XP_MAP): XpPlan {
  const awards = xpAwardsForEvent(type, payload, xpMap);
  if (awards.length === 0) return { primary: null, secondary: [] };
  if (PRIMARY_REF_EVENTS.has(type)) {
    return { primary: awards[0]!, secondary: awards.slice(1) };
  }
  return { primary: null, secondary: awards };
}

/** Строка xp_events из начисления: диспетчер штампует день в TZ пользователя. */
export function xpEventRow(
  userId: string,
  award: XpAward,
  day: Date,
): Prisma.XpEventCreateManyInput {
  return {
    userId,
    type: award.xpType,
    amount: award.amount,
    refType: award.refType,
    refId: award.refId,
    day,
  };
}

// --- Агрегаторы ---

/** Суммарный XP пользователя (для уровня). */
export async function getTotalXp(db: Db, userId: string): Promise<number> {
  const agg = await db.xpEvent.aggregate({ where: { userId }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

/** XP за сегодня (TZ пользователя) — числитель кольца дневной цели (spec 7.7). */
export async function getTodayXp(
  db: Db,
  userId: string,
  now: Date,
  timezone: string,
): Promise<number> {
  const day = dateOnlyUtc(localDateStr(now, timezone));
  const agg = await db.xpEvent.aggregate({ where: { userId, day }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

export interface XpSummary {
  totalXp: number;
  level: LevelInfo;
}

/** Уровень + прогресс для бейджа в шапке дашборда (spec 8.3). */
export async function getXpSummary(db: Db, userId: string): Promise<XpSummary> {
  const totalXp = await getTotalXp(db, userId);
  return { totalXp, level: levelForXp(totalXp) };
}
