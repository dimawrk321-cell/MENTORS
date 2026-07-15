import type { Db } from "@/lib/db";
import {
  addDays,
  dateOnlyUtc,
  isoWeekday,
  localDateStr,
  localHour,
  zonedDayUtcRange,
} from "@/lib/utils/dates";

// Достижения (spec 7.7). Движок проверки живёт внутри диспетчера событий (events.ts):
// по типу события считает условия и выдаёт достижения атомарно и идемпотентно
// (уникальный (user, achievement_key) + createMany skipDuplicates). Возвращает
// новые достижения для toast (spec 5.4/5.6: монохромный глиф + вибрация).
//
// Определения — код (источник истины); таблица achievements сидится из этой же
// константы (seedAchievements). Этот модуль НЕ импортирует events.ts (иначе цикл)
// и считает условия прямыми запросами, не завися от content/tests-сервисов.

export interface AchievementDef {
  key: string;
  title: string;
  description: string;
  hidden: boolean;
  /** Имя монохромного глифа Lucide (spec 5.6). */
  icon: string;
}

/** Справочник достижений (spec 7.7). hidden не светятся до получения. */
export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: "first_lesson",
    title: "Первый шаг",
    description: "Заверши первый урок",
    hidden: false,
    icon: "Footprints",
  },
  {
    key: "first_module",
    title: "Модуль закрыт",
    description: "Закрой первый модуль",
    hidden: false,
    icon: "PackageCheck",
  },
  {
    key: "first_course",
    title: "Курс пройден",
    description: "Пройди первый курс полностью",
    hidden: false,
    icon: "GraduationCap",
  },
  {
    key: "all_courses",
    title: "Вся программа",
    description: "Пройди все курсы",
    hidden: false,
    icon: "Trophy",
  },
  {
    key: "perfect_test",
    title: "Без единой ошибки",
    description: "Сдай модульный тест на 100%",
    hidden: false,
    icon: "Target",
  },
  {
    key: "five_first_try",
    title: "С первого раза ×5",
    description: "Сдай 5 модульных тестов подряд с первой попытки",
    hidden: false,
    icon: "Rocket",
  },
  {
    key: "cards_100",
    title: "Сотня",
    description: "Ответь на 100 карточек",
    hidden: false,
    icon: "Layers",
  },
  {
    key: "cards_1000",
    title: "Тысяча",
    description: "Ответь на 1000 карточек",
    hidden: false,
    icon: "Library",
  },
  {
    key: "queue_month",
    title: "Железная дисциплина",
    description: "Закрывай очередь 30 учебных дней подряд",
    hidden: false,
    icon: "CalendarCheck",
  },
  {
    key: "first_mock",
    title: "Боевое крещение",
    description: "Пройди первый мок",
    hidden: false,
    icon: "Swords",
  },
  {
    key: "five_mocks",
    title: "Ветеран моков",
    description: "Пройди 5 моков",
    hidden: false,
    icon: "Medal",
  },
  {
    key: "ready_theory",
    title: "Готов: теория",
    description: "Получи вердикт «готов» по теории",
    hidden: false,
    icon: "BadgeCheck",
  },
  {
    key: "ready_legend",
    title: "Готов: легенда",
    description: "Получи вердикт «готов» по легенде",
    hidden: false,
    icon: "ScrollText",
  },
  { key: "streak_7", title: "Неделя", description: "Серия 7 дней", hidden: false, icon: "Flame" },
  { key: "streak_30", title: "Месяц", description: "Серия 30 дней", hidden: false, icon: "Flame" },
  {
    key: "streak_100",
    title: "Сотня",
    description: "Серия 100 дней",
    hidden: false,
    icon: "Flame",
  },
  { key: "streak_365", title: "Год", description: "Серия 365 дней", hidden: false, icon: "Flame" },
  {
    key: "night_shift",
    title: "Ночная смена",
    description: "Заверши урок с 00:00 до 05:00",
    hidden: true,
    icon: "Moon",
  },
  {
    key: "combo",
    title: "Комбо",
    description: "Урок, тест, очередь и мок за один день",
    hidden: true,
    icon: "Zap",
  },
];

export const ACHIEVEMENT_BY_KEY: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.key, a]),
);

export type EarnedAchievement = AchievementDef;

/** Сид справочника (spec 7.7); вызывается из prisma/seed.ts и в тестах достижений. */
export async function seedAchievements(db: Db): Promise<void> {
  for (const a of ACHIEVEMENTS) {
    await db.achievement.upsert({
      where: { key: a.key },
      create: {
        key: a.key,
        title: a.title,
        description: a.description,
        hidden: a.hidden,
        icon: a.icon,
      },
      update: { title: a.title, description: a.description, hidden: a.hidden, icon: a.icon },
    });
  }
}

// --- Payload helpers ---

function pStr(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return null;
}
function pNum(payload: unknown, key: string): number | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "number") return v;
  }
  return null;
}

// --- Условия (прямые запросы) ---

async function hasCompletedLesson(db: Db, userId: string): Promise<boolean> {
  return (await db.lessonProgress.count({ where: { userId, status: "completed" } })) > 0;
}

interface ModuleClosure {
  closed: boolean;
  /**
   * Есть «ворота» — обязательные уроки ИЛИ включённый тест: настоящий закрываемый
   * модуль, а не пустой/полностью необязательный (тот закрыт вакуумно). Модуль,
   * закрываемый только сдачей теста (без обязательных уроков), тоже настоящий.
   */
  hasGate: boolean;
}

async function moduleClosure(db: Db, userId: string, moduleId: string): Promise<ModuleClosure> {
  const required = await db.lesson.findMany({
    where: { moduleId, status: "published", isOptional: false },
    select: { id: true },
  });
  const test = await db.moduleTest.findUnique({ where: { moduleId }, select: { enabled: true } });
  const testEnabled = test?.enabled === true;
  let closed = true;
  if (required.length > 0) {
    const completed = await db.lessonProgress.count({
      where: { userId, status: "completed", lessonId: { in: required.map((l) => l.id) } },
    });
    if (completed < required.length) closed = false;
  }
  if (closed && testEnabled) {
    const passed = await db.testAttempt.count({ where: { userId, moduleId, passed: true } });
    if (passed === 0) closed = false;
  }
  return { closed, hasGate: required.length > 0 || testEnabled };
}

/** Курс пройден: ≥1 модуль, все закрыты И хотя бы один — настоящий (с воротами). */
async function isCourseCompleted(db: Db, userId: string, courseId: string): Promise<boolean> {
  const modules = await db.module.findMany({
    where: { courseId, status: "published" },
    select: { id: true },
  });
  if (modules.length === 0) return false;
  let anyGate = false;
  for (const mod of modules) {
    const closure = await moduleClosure(db, userId, mod.id);
    if (!closure.closed) return false;
    if (closure.hasGate) anyGate = true;
  }
  return anyGate;
}

async function areAllCoursesCompleted(db: Db, userId: string): Promise<boolean> {
  const courses = await db.course.findMany({
    where: { status: "published" },
    select: { id: true },
  });
  if (courses.length === 0) return false;
  for (const course of courses) {
    if (!(await isCourseCompleted(db, userId, course.id))) return false;
  }
  return true;
}

/** Длина хвоста подряд сданных с 1-й попытки модульных тестов; провал/непервая попытка рвут (spec 7.7). */
async function firstTryPassRun(db: Db, userId: string): Promise<number> {
  const events = await db.analyticsEvent.findMany({
    where: { userId, type: { in: ["test.passed", "test.failed"] } },
    orderBy: { createdAt: "asc" },
    select: { type: true, payload: true },
  });
  let run = 0;
  for (const e of events) {
    if (pStr(e.payload, "kind") !== "module") continue;
    if (e.type === "test.passed" && pNum(e.payload, "attemptNumber") === 1) run += 1;
    else run = 0;
  }
  return run;
}

async function courseIdOfModule(db: Db, moduleId: string): Promise<string | null> {
  const mod = await db.module.findUnique({ where: { id: moduleId }, select: { courseId: true } });
  return mod?.courseId ?? null;
}

/** Подряд закрытая очередь на учебных днях, считая назад от сегодня (spec 7.7). */
async function consecutiveQueueStudyDays(
  db: Db,
  userId: string,
  now: Date,
  timezone: string,
  studyDays: number[],
): Promise<number> {
  const events = await db.analyticsEvent.findMany({
    where: { userId, type: "queue.completed" },
    select: { payload: true },
  });
  const closedDays = new Set(
    events.map((e) => pStr(e.payload, "day")).filter((d): d is string => d !== null),
  );
  let count = 0;
  let cursor = localDateStr(now, timezone);
  for (let i = 0; i < 400 && count < 30; i += 1) {
    if (studyDays.includes(isoWeekday(cursor))) {
      if (closedDays.has(cursor)) count += 1;
      else break; // учебный день без закрытой очереди рвёт серию
    }
    cursor = localDateStr(addDays(dateOnlyUtc(cursor), -1), "UTC");
  }
  return count;
}

/**
 * Урок + тест + очередь + мок за один день (TZ) — недостижимо без мока (spec 7.7).
 * «День» события определяется по created_at (моменту записи) — в бою он совпадает
 * с now, так как диспетчер работает в реальном времени.
 */
async function comboToday(db: Db, userId: string, now: Date, timezone: string): Promise<boolean> {
  const { start, end } = zonedDayUtcRange(localDateStr(now, timezone), timezone);
  const events = await db.analyticsEvent.findMany({
    where: {
      userId,
      createdAt: { gte: start, lt: end },
      type: {
        in: [
          "lesson.completed",
          "test.passed",
          "testout.passed",
          "queue.completed",
          "mock.completed",
        ],
      },
    },
    select: { type: true },
  });
  const types = new Set(events.map((e) => e.type));
  return (
    types.has("lesson.completed") &&
    (types.has("test.passed") || types.has("testout.passed")) &&
    types.has("queue.completed") &&
    types.has("mock.completed")
  );
}

// --- Движок ---

export interface AchievementContext {
  userId: string;
  type: string;
  payload: unknown;
  now: Date;
  timezone: string;
  studyDays: number[];
}

/**
 * Проверяет и выдаёт достижения по событию. Идемпотентно (skipDuplicates),
 * возвращает только НОВЫЕ достижения для toast. Вызывается диспетчером внутри
 * транзакции вызывающего действия — свежезаписанные analytics_events видны.
 */
export async function evaluateAchievements(
  db: Db,
  ctx: AchievementContext,
): Promise<EarnedAchievement[]> {
  const earned: EarnedAchievement[] = [];
  const grant = async (key: string): Promise<void> => {
    const res = await db.userAchievement.createMany({
      data: [{ userId: ctx.userId, achievementKey: key, earnedAt: ctx.now }],
      skipDuplicates: true,
    });
    if (res.count > 0) {
      const def = ACHIEVEMENT_BY_KEY[key];
      if (def) earned.push(def);
    }
  };

  // Закрытие модуля/курса/всей программы — общий шаг для завершения урока и тестов.
  const checkModuleAndCourse = async (moduleId: string | null): Promise<void> => {
    if (!moduleId) return;
    const closure = await moduleClosure(db, ctx.userId, moduleId);
    if (!closure.closed) return;
    if (closure.hasGate) await grant("first_module");
    const courseId = await courseIdOfModule(db, moduleId);
    if (courseId && (await isCourseCompleted(db, ctx.userId, courseId))) {
      await grant("first_course");
      if (await areAllCoursesCompleted(db, ctx.userId)) await grant("all_courses");
    }
  };

  switch (ctx.type) {
    case "lesson.completed": {
      if (await hasCompletedLesson(db, ctx.userId)) await grant("first_lesson");
      if (localHour(ctx.now, ctx.timezone) < 5) await grant("night_shift");
      await checkModuleAndCourse(pStr(ctx.payload, "moduleId"));
      if (await comboToday(db, ctx.userId, ctx.now, ctx.timezone)) await grant("combo");
      break;
    }
    case "testout.passed": {
      // Test-out засчитывает уроки модуля → первый шаг тоже возможен через него.
      if (await hasCompletedLesson(db, ctx.userId)) await grant("first_lesson");
      await checkModuleAndCourse(pStr(ctx.payload, "moduleId"));
      if (await comboToday(db, ctx.userId, ctx.now, ctx.timezone)) await grant("combo");
      break;
    }
    case "test.passed": {
      if (pStr(ctx.payload, "kind") === "module") {
        if (pNum(ctx.payload, "score") === 100) await grant("perfect_test");
        if ((await firstTryPassRun(db, ctx.userId)) >= 5) await grant("five_first_try");
        await checkModuleAndCourse(pStr(ctx.payload, "moduleId"));
      }
      if (await comboToday(db, ctx.userId, ctx.now, ctx.timezone)) await grant("combo");
      break;
    }
    case "card.reviewed": {
      const answered = await db.srsReview.count({ where: { card: { userId: ctx.userId } } });
      if (answered >= 100) await grant("cards_100");
      if (answered >= 1000) await grant("cards_1000");
      break;
    }
    case "queue.completed": {
      if (
        (await consecutiveQueueStudyDays(db, ctx.userId, ctx.now, ctx.timezone, ctx.studyDays)) >=
        30
      ) {
        await grant("queue_month");
      }
      if (await comboToday(db, ctx.userId, ctx.now, ctx.timezone)) await grant("combo");
      break;
    }
    case "mock.completed": {
      const mocks = await db.analyticsEvent.count({
        where: { userId: ctx.userId, type: "mock.completed" },
      });
      if (mocks >= 1) await grant("first_mock");
      if (mocks >= 5) await grant("five_mocks");
      if (await comboToday(db, ctx.userId, ctx.now, ctx.timezone)) await grant("combo");
      break;
    }
    case "feedback.published": {
      if (pStr(ctx.payload, "verdict") === "ready") {
        const kind = pStr(ctx.payload, "type");
        if (kind === "theory") await grant("ready_theory");
        else if (kind === "legend") await grant("ready_legend");
      }
      break;
    }
    case "streak.milestone": {
      const m = pNum(ctx.payload, "milestone");
      if (m !== null) await grant(`streak_${m}`);
      break;
    }
    default:
      break;
  }

  return earned;
}

// --- Витрина (профиль/«Ещё»): счётчик и список полученных (spec 8.3, минимально) ---

export interface UserAchievementsSummary {
  count: number;
  earned: Array<EarnedAchievement & { earnedAt: Date }>;
}

export async function getUserAchievements(
  db: Db,
  userId: string,
): Promise<UserAchievementsSummary> {
  const rows = await db.userAchievement.findMany({
    where: { userId },
    orderBy: { earnedAt: "desc" },
  });
  const earned = rows.flatMap((row) => {
    const def = ACHIEVEMENT_BY_KEY[row.achievementKey];
    return def ? [{ ...def, earnedAt: row.earnedAt }] : [];
  });
  return { count: earned.length, earned };
}
