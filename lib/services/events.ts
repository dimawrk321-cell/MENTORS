import type { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import { dateOnlyUtc, localDateStr } from "@/lib/utils/dates";
import { getTotalXp, levelForXp, planXp, xpEventRow } from "@/lib/services/xp";
import { countStreakDay, STREAK_QUALIFYING_EVENTS } from "@/lib/services/streak";
import { evaluateAchievements, type EarnedAchievement } from "@/lib/services/achievements";

export type { EarnedAchievement };

// Единый диспетчер доменных событий (spec 7.13). Полный контракт: (1) пишет
// analytics_events; (2) начисляет XP по карте 7.7 (идемпотентно); (3) обновляет
// стрик; (4) проверяет достижения; (5) ставит уведомления (заглушка до этапа 9).
// Всё — в одной транзакции с вызывающим действием (клиент `db` может быть tx).
// Ни один модуль не начисляет XP/достижения напрямую — только через emitEvent.
//
// Идемпотентность и exactly-once: барьером служит уникальный индекс xp_events
// (user, type, ref_type, ref_id). «Первичное» начисление события вставляется через
// createMany skipDuplicates (INSERT ... ON CONFLICT DO NOTHING — без исключения,
// не отравляет транзакцию вызывающего): count=0 ⇒ это реплей ⇒ всё событие
// подавляется. Так закрыто ограничение этапа 4 (queue.completed из двух вкладок:
// гонка двух транзакций даёт одну XP-запись, дубль подавляется).

/** События, запускающие геймификацию (XP / стрик / достижения). Остальные —
 *  только analytics_events (быстрый путь). */
const GAMIFIED_TYPES = new Set([
  "lesson.completed",
  "quiz.answered",
  "test.passed",
  "test.failed",
  "testout.passed",
  "card.reviewed",
  "queue.completed",
  "mock.completed",
  "feedback.published",
  "streak.milestone",
]);

export interface EmitResult {
  /** false, если событие подавлено как дубль (реплей / гонка). */
  recorded: boolean;
  /** XP, начисленный этим событием (включая вехи стрика). */
  xpAwarded: number;
  /** Новый уровень, если это событие подняло уровень (иначе null) — ритуал. */
  leveledUpTo: number | null;
  /** Новые достижения — для toast (spec 5.4/5.6). */
  earnedAchievements: EarnedAchievement[];
}

const EMPTY_RESULT: EmitResult = {
  recorded: true,
  xpAwarded: 0,
  leveledUpTo: null,
  earnedAchievements: [],
};

/** Складывает два результата эмита в один (для действия с несколькими событиями). */
export function mergeEmitResults(a: EmitResult, b: EmitResult): EmitResult {
  return {
    recorded: a.recorded && b.recorded,
    xpAwarded: a.xpAwarded + b.xpAwarded,
    leveledUpTo: b.leveledUpTo ?? a.leveledUpTo,
    earnedAchievements: [...a.earnedAchievements, ...b.earnedAchievements],
  };
}

export async function emitEvent(
  db: Db,
  type: string,
  payload: Prisma.InputJsonValue,
  opts: { userId?: string | null; now?: Date } = {},
): Promise<EmitResult> {
  const userId = opts.userId ?? null;
  const now = opts.now ?? new Date();

  // Быстрый путь: события без пользователя или без геймификации — только аналитика.
  if (!userId || !GAMIFIED_TYPES.has(type)) {
    await db.analyticsEvent.create({ data: { type, payload, userId } });
    return EMPTY_RESULT;
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { timezone: true, studyDays: true },
  });
  if (!user) {
    await db.analyticsEvent.create({ data: { type, payload, userId } });
    return EMPTY_RESULT;
  }
  const day = dateOnlyUtc(localDateStr(now, user.timezone));

  // (2a) XP: первичное начисление — барьер идемпотентности всего события.
  const plan = planXp(type, payload);
  if (plan.primary) {
    const claimed = await db.xpEvent.createMany({
      data: [xpEventRow(userId, plan.primary, day)],
      skipDuplicates: true,
    });
    if (claimed.count === 0) {
      // Реплей / гонка (в т.ч. queue.completed из двух вкладок): подавляем событие.
      return { ...EMPTY_RESULT, recorded: false };
    }
  }

  // (1) analytics_events.
  await db.analyticsEvent.create({ data: { type, payload, userId } });

  // (2b) Вторичные начисления (идемпотентны по собственному ref).
  let xpAwarded = plan.primary?.amount ?? 0;
  for (const award of plan.secondary) {
    const res = await db.xpEvent.createMany({
      data: [xpEventRow(userId, award, day)],
      skipDuplicates: true,
    });
    if (res.count > 0) xpAwarded += award.amount;
  }

  // (3) Стрик: качественное событие засчитывает учебный день; вехи эмитятся здесь
  // (стрик их лишь возвращает, чтобы не зависеть от events.ts).
  const nestedAchievements: EarnedAchievement[] = [];
  if (STREAK_QUALIFYING_EVENTS.has(type)) {
    const streakResult = await countStreakDay(db, { userId, now });
    for (const milestone of streakResult.milestonesReached) {
      const nested = await emitEvent(db, "streak.milestone", { milestone }, { userId, now });
      xpAwarded += nested.xpAwarded;
      nestedAchievements.push(...nested.earnedAchievements);
    }
  }

  // (4) Достижения по этому событию.
  const earned = await evaluateAchievements(db, {
    userId,
    type,
    payload,
    now,
    timezone: user.timezone,
    studyDays: user.studyDays,
  });

  // (5) Уведомления — заглушка до этапа 9 (freeze_used ставится внутри стрика).

  // Ритуал уровня: сравниваем уровень до/после по суммарному XP (spec 7.7).
  let leveledUpTo: number | null = null;
  if (xpAwarded > 0) {
    const totalAfter = await getTotalXp(db, userId);
    const after = levelForXp(totalAfter).level;
    const before = levelForXp(totalAfter - xpAwarded).level;
    if (after > before) leveledUpTo = after;
  }

  return {
    recorded: true,
    xpAwarded,
    leveledUpTo,
    earnedAchievements: [...earned, ...nestedAchievements],
  };
}
