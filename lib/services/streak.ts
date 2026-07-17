import type { PrismaClient, Streak } from "@prisma/client";
import type { Db } from "@/lib/db";
import { addDays, dateOnlyUtc, isoWeekday, localDateStr, localHour } from "@/lib/utils/dates";
import { notify } from "@/lib/services/notifications";

// Стрик — серия учебных дней (spec 7.7). Модель: day засчитан, если за день (TZ)
// случилось качественное событие И это учебный день (users.study_days).
// Исключённые дни прозрачны — не рвут серию и не требуют активности. «Конец дня»
// (заморозка/обнуление пропущенных учебных дней) — ленивый обработчик
// processStreakDay: срабатывает при первом визите нового дня и в worker (этап 9).
//
// Диспетчер событий (events.ts) — единственный, кто засчитывает дни: он вызывает
// countStreakDay на качественном событии и эмитит streak.milestone по возвращённым
// вехам. Стрик НЕ импортирует events.ts (иначе цикл) — он лишь возвращает вехи.

/** События, засчитывающие учебный день (spec 7.7). DECISION: любая попытка теста —
 *  модульного или экстерна (test.passed/test.failed/testout.passed) — считается
 *  учебной активностью, единообразно с «попытка модульного теста». */
export const STREAK_QUALIFYING_EVENTS = new Set([
  "lesson.completed",
  "quiz.answered",
  "test.passed",
  "test.failed",
  "testout.passed",
  "queue.completed",
]);

/** Вехи серии (spec 7.7): эмитятся при достижении. */
export const STREAK_MILESTONES = [7, 30, 100, 365] as const;

/** Заморозок максимум (spec 7.7). */
export const STREAK_FREEZE_CAP = 2;
/** +1 заморозка за каждые N подряд засчитанных дней (spec 7.7). */
export const STREAK_FREEZE_EVERY = 7;

// --- Утилиты дат серии ---

/** Учебные календарные даты d, где afterStr < d < beforeStr (границы исключены). */
function studyDatesBetween(afterStr: string, beforeStr: string, studyDays: number[]): string[] {
  const result: string[] = [];
  let cursor = localDateStr(addDays(dateOnlyUtc(afterStr), 1), "UTC");
  while (cursor < beforeStr) {
    if (studyDays.includes(isoWeekday(cursor))) result.push(cursor);
    cursor = localDateStr(addDays(dateOnlyUtc(cursor), 1), "UTC");
  }
  return result;
}

async function ensureStreak(db: Db, userId: string): Promise<Streak> {
  // Гонка двух первых событий (две вкладки): upsert = INSERT ... ON CONFLICT DO
  // UPDATE — не бросает P2002 и не отравляет транзакцию вызывающего действия
  // (в отличие от create+catch, где второй INSERT абортит tx). Пустой update —
  // «строка уже есть, ничего не меняем».
  return db.streak.upsert({ where: { userId }, create: { userId }, update: {} });
}

interface StreakSnapshot {
  current: number;
  best: number;
  freezes: number;
  lastCountedStr: string | null;
}

/**
 * Разрешает пропущенные учебные дни в интервале (last_counted, today): за каждый
 * либо тратится заморозка (серия сохранена, freeze_used + уведомление-заглушка),
 * либо серия обнуляется (reset, без уведомления — негатив не шлём). Пишет
 * изменения на переданный клиент (tx или root). Инвариант: любой учебный день
 * строго между last_counted и today не имел активности (иначе last_counted был бы
 * ≥ него) — потому доп. запросов по прошлым дням не нужно.
 */
async function runCatchUp(
  db: Db,
  userId: string,
  streak: Streak,
  todayStr: string,
  studyDays: number[],
): Promise<StreakSnapshot> {
  const lastStr = streak.lastCountedDate ? localDateStr(streak.lastCountedDate, "UTC") : null;
  const snap: StreakSnapshot = {
    current: streak.current,
    best: streak.best,
    freezes: streak.freezes,
    lastCountedStr: lastStr,
  };
  if (!lastStr || lastStr >= todayStr) return snap;

  const missed = studyDatesBetween(lastStr, todayStr, studyDays);
  if (missed.length === 0) return snap;

  const events: { userId: string; date: Date; kind: "freeze_used" | "reset" }[] = [];
  for (const day of missed) {
    if (snap.freezes > 0) {
      snap.freezes -= 1;
      snap.lastCountedStr = day; // заморозка покрыла день — цепочка продолжается с него
      events.push({ userId, date: dateOnlyUtc(day), kind: "freeze_used" });
      // Автоприменение заморозки — уведомление freeze_used (spec 7.7/7.12).
      await notify(db, userId, "freeze_used", { freezesLeft: snap.freezes });
    } else {
      snap.current = 0;
      snap.lastCountedStr = null; // серия порвана — стартует заново со следующей активности
      events.push({ userId, date: dateOnlyUtc(day), kind: "reset" });
      break;
    }
  }

  await db.streak.update({
    where: { userId },
    data: {
      current: snap.current,
      freezes: snap.freezes,
      lastCountedDate: snap.lastCountedStr ? dateOnlyUtc(snap.lastCountedStr) : null,
    },
  });
  await db.streakEvent.createMany({ data: events });
  return snap;
}

export interface CountStreakResult {
  /** Вехи, достигнутые этим засчитанным днём (0 или 1 элемент). */
  milestonesReached: number[];
  counted: boolean;
  current: number;
}

/**
 * Засчитывает текущий день по качественному событию (spec 7.7). Вызывается
 * диспетчером внутри транзакции вызывающего действия. Возвращает достигнутые вехи —
 * их эмитит диспетчер (streak.milestone), чтобы стрик не зависел от events.ts.
 */
export async function countStreakDay(
  db: Db,
  input: { userId: string; now: Date },
): Promise<CountStreakResult> {
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { timezone: true, studyDays: true },
  });
  if (!user) return { milestonesReached: [], counted: false, current: 0 };

  const streak = await ensureStreak(db, input.userId);
  if (streak.paused) return { milestonesReached: [], counted: false, current: streak.current };

  const todayStr = localDateStr(input.now, user.timezone);
  // Исключённый день прозрачен: не считается (spec 7.7).
  if (!user.studyDays.includes(isoWeekday(todayStr))) {
    return { milestonesReached: [], counted: false, current: streak.current };
  }

  const snap = await runCatchUp(db, input.userId, streak, todayStr, user.studyDays);
  if (snap.lastCountedStr === todayStr) {
    // День уже засчитан — идемпотентно.
    return { milestonesReached: [], counted: false, current: snap.current };
  }

  const current = snap.current + 1;
  const best = Math.max(snap.best, current);
  let freezes = snap.freezes;
  // +1 заморозка за каждые 7 подряд засчитанных дней, cap 2 (spec 7.7).
  if (current % STREAK_FREEZE_EVERY === 0 && freezes < STREAK_FREEZE_CAP) {
    freezes += 1;
  }

  await db.streak.update({
    where: { userId: input.userId },
    data: { current, best, freezes, lastCountedDate: dateOnlyUtc(todayStr) },
  });
  await db.streakEvent.create({
    data: { userId: input.userId, date: dateOnlyUtc(todayStr), kind: "counted" },
  });

  const milestonesReached = STREAK_MILESTONES.filter((m) => m === current);
  if (milestonesReached.length > 0) {
    await db.streakEvent.create({
      data: { userId: input.userId, date: dateOnlyUtc(todayStr), kind: "milestone" },
    });
  }

  return { milestonesReached: [...milestonesReached], counted: true, current };
}

/**
 * Ленивый обработчик «конца дня» (spec 7.7): разрешает пропущенные учебные дни
 * до сегодня. Идемпотентен — повторный вызов в тот же день ничего не меняет.
 * Вызывается при первом визите нового дня и джобой worker (этап 9).
 */
export async function processStreakDay(
  db: PrismaClient,
  input: { userId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const streak = await db.streak.findUnique({ where: { userId: input.userId } });
  if (!streak || streak.paused || !streak.lastCountedDate) return;

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { timezone: true, studyDays: true },
  });
  if (!user) return;

  const todayStr = localDateStr(now, user.timezone);
  const lastStr = localDateStr(streak.lastCountedDate, "UTC");
  if (lastStr >= todayStr) return;
  if (studyDatesBetween(lastStr, todayStr, user.studyDays).length === 0) return;

  await db.$transaction(async (tx) => {
    // Lock the streak row and re-read fresh INSIDE the tx: the checks above use an
    // unlocked snapshot (cheap early-out), but the worker (streakProcess) and the
    // first-visit dashboard render can call this concurrently — without the lock
    // both would see the same pre-state and double-apply catch-up (duplicate
    // freeze_used notification + streak_events). The loser blocks here, then sees
    // the advanced last_counted_date and no-ops.
    await tx.$queryRaw`SELECT id FROM streaks WHERE user_id = ${input.userId} FOR UPDATE`;
    const fresh = await tx.streak.findUnique({ where: { userId: input.userId } });
    if (!fresh || fresh.paused || !fresh.lastCountedDate) return;
    const freshLastStr = localDateStr(fresh.lastCountedDate, "UTC");
    if (freshLastStr >= todayStr) return;
    if (studyDatesBetween(freshLastStr, todayStr, user.studyDays).length === 0) return;
    await runCatchUp(tx, input.userId, fresh, todayStr, user.studyDays);
  });
}

/** Ставит серию на паузу при истечении доступа (spec 7.1.5): дни не считаются. */
export async function pauseStreak(db: Db, userId: string): Promise<void> {
  await db.streak.updateMany({ where: { userId }, data: { paused: true } });
}

/**
 * Снимает паузу при продлении доступа (spec 7.1.7). Пауза была прозрачной
 * («серия не сгорает», 7.1.5), поэтому одновременно сдвигаем last_counted_date на
 * день продления: иначе первый визит после продления запустил бы catch-up по всему
 * замороженному интервалу и обнулил бы сохранённую серию (spec 7.7). Якорь ставим
 * только для живой серии (current > 0); today не инкрементит — это точка
 * возобновления, дальше действуют обычные правила.
 */
export async function unpauseStreak(db: Db, userId: string, now: Date): Promise<void> {
  const streak = await db.streak.findUnique({ where: { userId } });
  if (!streak) return;
  if (streak.current > 0 && streak.lastCountedDate) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const anchor = user ? dateOnlyUtc(localDateStr(now, user.timezone)) : streak.lastCountedDate;
    await db.streak.update({
      where: { userId },
      data: { paused: false, lastCountedDate: anchor },
    });
    return;
  }
  await db.streak.update({ where: { userId }, data: { paused: false } });
}

export interface StreakState {
  current: number;
  best: number;
  freezes: number;
  todayCounted: boolean;
  /** «Под угрозой» после 20:00, день не засчитан, серия ≥3 (spec 5.3/8.3). */
  atRisk: boolean;
  paused: boolean;
}

/** Состояние для StreakBadge на дашборде. Вызывать после processStreakDay. */
export async function getStreakState(
  db: Db,
  input: { userId: string; now: Date; timezone: string; studyDays: number[] },
): Promise<StreakState> {
  const streak = await db.streak.findUnique({ where: { userId: input.userId } });
  if (!streak) {
    return { current: 0, best: 0, freezes: 0, todayCounted: false, atRisk: false, paused: false };
  }
  const todayStr = localDateStr(input.now, input.timezone);
  const lastStr = streak.lastCountedDate ? localDateStr(streak.lastCountedDate, "UTC") : null;
  const todayCounted = lastStr === todayStr;
  const isStudyDay = input.studyDays.includes(isoWeekday(todayStr));
  const atRisk =
    !streak.paused &&
    isStudyDay &&
    !todayCounted &&
    streak.current >= 3 &&
    localHour(input.now, input.timezone) >= 20;
  return {
    current: streak.current,
    best: streak.best,
    freezes: streak.freezes,
    todayCounted,
    atRisk,
    paused: streak.paused,
  };
}
