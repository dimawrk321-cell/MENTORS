import type { Track } from "@prisma/client";
import type { Db } from "@/lib/db";
import {
  addDays,
  dateOnlyUtc,
  isoWeekday,
  localDateStr,
  zonedDayUtcRange,
} from "@/lib/utils/dates";
import { getCourseView } from "@/lib/services/content";

// Дашборд-агрегаторы (spec 8.3): «Продолжить» (текущий/первый открытый урок) и
// Heatmap активности. Курсы-прогресс дашборд берёт из listCoursesForStudent,
// очередь/западающие — из srs.ts, стрик/цель/уровень — из streak.ts/xp.ts.

// --- «Продолжить» (spec 8.3) ---

export interface ContinueTarget {
  /** continue — есть начатый урок; start — первый открытый по треку. */
  mode: "continue" | "start";
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
  moduleTitle: string;
  /** Прогресс модуля по обязательным урокам. */
  moduleDone: number;
  moduleTotal: number;
}

const publishedLessonFilter = {
  status: "published" as const,
  module: { status: "published" as const, course: { status: "published" as const } },
};

/** Упорядоченные опубликованные курсы: сперва по треку, затем остальные (spec 8.3). */
async function orderedCourses(db: Db, track: Track | null) {
  const courses = await db.course.findMany({
    where: { status: "published" },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, slug: true },
  });
  if (!track) return courses;
  const trackDef = await db.trackDef.findUnique({ where: { key: track } });
  const trackOrder = (trackDef?.courseIds as string[] | undefined) ?? [];
  const rank = new Map(trackOrder.map((id, index) => [id, index]));
  return [...courses].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

type CourseViewResult = NonNullable<Awaited<ReturnType<typeof getCourseView>>>;

function buildTarget(
  mode: "continue" | "start",
  view: CourseViewResult,
  lessonId: string,
): ContinueTarget | null {
  for (const mod of view.course.modules) {
    const lesson = mod.lessons.find((l) => l.id === lessonId);
    if (!lesson) continue;
    const moduleState = view.state.modules.get(mod.id);
    return {
      mode,
      lessonId,
      lessonTitle: lesson.title,
      courseTitle: view.course.title,
      moduleTitle: mod.title,
      moduleDone: moduleState?.completedRequired ?? 0,
      moduleTotal: moduleState?.totalRequired ?? 0,
    };
  }
  return null;
}

/**
 * Hero «Продолжить» (spec 8.3): текущий урок — последний in_progress; иначе
 * первый открытый по порядку трека. null — начатого нет и открытых нет.
 */
export async function getContinueTarget(
  db: Db,
  userId: string,
  track: Track | null,
): Promise<ContinueTarget | null> {
  const inProgress = await db.lessonProgress.findFirst({
    where: { userId, status: "in_progress", lesson: publishedLessonFilter },
    orderBy: { updatedAt: "desc" },
    include: { lesson: { include: { module: { include: { course: true } } } } },
  });
  if (inProgress) {
    const view = await getCourseView(db, inProgress.lesson.module.course.slug, userId);
    const target = view && buildTarget("continue", view, inProgress.lessonId);
    if (target) return target;
  }

  // Первый открытый (unlocked, не завершённый) урок по треку.
  for (const course of await orderedCourses(db, track)) {
    const view = await getCourseView(db, course.slug, userId);
    if (view?.state.nextLessonId) {
      const target = buildTarget("start", view, view.state.nextLessonId);
      if (target) return target;
    }
  }
  return null;
}

// --- Heatmap (spec 5.3): 26 недель desktop / 12 mobile, 5 градаций, tooltip ---

export interface HeatmapCell {
  date: string;
  lessons: number;
  cards: number;
  tests: number;
  total: number;
  /** 0..4 — градация зелёного (0 = пусто). */
  level: number;
  /** Ячейка в будущем текущей недели — рендерится пустой. */
  future: boolean;
}

export interface HeatmapData {
  /** Колонки-недели (Пн…Вс), от старой к новой. */
  columns: HeatmapCell[][];
}

const HEATMAP_TYPES = [
  "lesson.completed",
  "card.reviewed",
  "test.passed",
  "test.failed",
  "testout.passed",
];

function heatmapLevel(total: number): number {
  if (total <= 0) return 0;
  if (total <= 4) return 1;
  if (total <= 10) return 2;
  if (total <= 20) return 3;
  return 4;
}

/**
 * Активность по дням для Heatmap из analytics_events (spec 5.3/8.3). Группировка
 * по локальной дате пользователя; сетка выровнена по неделям (Пн–Вс), последняя
 * колонка — текущая неделя. Кешируется на уровне страницы (unstable_cache 60с).
 */
export async function getHeatmapData(
  db: Db,
  input: { userId: string; now: Date; timezone: string; weeks: number },
): Promise<HeatmapData> {
  const todayStr = localDateStr(input.now, input.timezone);
  const mondayOffset = isoWeekday(todayStr) - 1;
  const mondayThisWeek = localDateStr(addDays(dateOnlyUtc(todayStr), -mondayOffset), "UTC");
  const startMonday = localDateStr(
    addDays(dateOnlyUtc(mondayThisWeek), -(input.weeks - 1) * 7),
    "UTC",
  );

  const { start } = zonedDayUtcRange(startMonday, input.timezone);
  const events = await db.analyticsEvent.findMany({
    where: { userId: input.userId, type: { in: HEATMAP_TYPES }, createdAt: { gte: start } },
    select: { type: true, createdAt: true },
  });

  const byDay = new Map<string, { lessons: number; cards: number; tests: number }>();
  for (const event of events) {
    const day = localDateStr(event.createdAt, input.timezone);
    const bucket = byDay.get(day) ?? { lessons: 0, cards: 0, tests: 0 };
    if (event.type === "lesson.completed") bucket.lessons += 1;
    else if (event.type === "card.reviewed") bucket.cards += 1;
    else bucket.tests += 1;
    byDay.set(day, bucket);
  }

  const columns: HeatmapCell[][] = [];
  for (let w = 0; w < input.weeks; w += 1) {
    const column: HeatmapCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = localDateStr(addDays(dateOnlyUtc(startMonday), w * 7 + d), "UTC");
      const bucket = byDay.get(date) ?? { lessons: 0, cards: 0, tests: 0 };
      const total = bucket.lessons + bucket.cards + bucket.tests;
      column.push({
        date,
        lessons: bucket.lessons,
        cards: bucket.cards,
        tests: bucket.tests,
        total,
        level: heatmapLevel(total),
        future: date > todayStr,
      });
    }
    columns.push(column);
  }
  return { columns };
}
