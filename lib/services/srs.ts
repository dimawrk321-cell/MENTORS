import type { PrismaClient, Question, SrsAddedFrom, SrsCard, SrsGrade } from "@prisma/client";
import type { Db } from "@/lib/db";
import { addDays, dateOnlyUtc, localDateStr, zonedDayUtcRange } from "@/lib/utils/dates";
import { emitEvent, mergeEmitResults, type EarnedAchievement } from "@/lib/services/events";

// SRS — интервальные повторения (spec 7.6), ядро продукта. Планировщик —
// чистая функция applyGrade (юнит-тесты всех переходов); источники карточек
// (завершение урока, ошибки квиза/теста, ручное добавление) и дневная очередь —
// ниже. Все «сегодня/завтра» — календарные даты в таймзоне пользователя,
// хранятся как date-колонки (полночь UTC).

/** Лестница интервалов в днях: step 0..4 (spec 7.6). */
export const SRS_STEPS = [1, 3, 7, 16, 35] as const;
/** step 5 — «выучен»: контрольный показ раз в 90 дней. */
export const SRS_LEARNED_STEP = 5;
export const SRS_LEARNED_INTERVAL_DAYS = 90;
/** Новых карточек в дневной выборке — не более 20 (spec 7.6). */
export const SRS_NEW_PER_DAY = 20;
/** Порция сессии — 15 карточек (spec 7.6). */
export const SRS_SESSION_SIZE = 15;
/** Оценка времени: count × 25 сек, округление вверх до минут (spec 7.6). */
export const SRS_SECONDS_PER_CARD = 25;
/** «Западающие темы» скрыты, пока ответов за 30 дней меньше 20 (spec 8.3). */
export const LAGGING_MIN_ANSWERS = 20;

export function estimateQueueMinutes(count: number): number {
  return Math.ceil((count * SRS_SECONDS_PER_CARD) / 60);
}

// --- Планировщик (spec 7.6) — чистое ядро ---

export interface GradeTransition {
  step: number;
  nextReviewAt: Date;
  lapses: number;
}

/**
 * Переход по оценке (spec 7.6). `today` — UTC-полночь календарного «сегодня»
 * пользователя (dateOnlyUtc(localDateStr(now, tz))).
 * - again: step → 0, next = завтра, lapses+1 (только «Не знаю» копит lapses);
 * - hard: step не меняется, next = today + STEPS[step] (на step 5 — +90);
 * - good: step+1 (cap 5), next = today + STEPS[new_step] (на step 5 — +90).
 */
export function applyGrade(
  card: { step: number; lapses: number },
  grade: SrsGrade,
  today: Date,
): GradeTransition {
  if (grade === "again") {
    return { step: 0, nextReviewAt: addDays(today, 1), lapses: card.lapses + 1 };
  }
  if (grade === "hard") {
    const days = card.step >= SRS_LEARNED_STEP ? SRS_LEARNED_INTERVAL_DAYS : SRS_STEPS[card.step]!;
    return { step: card.step, nextReviewAt: addDays(today, days), lapses: card.lapses };
  }
  const step = Math.min(card.step + 1, SRS_LEARNED_STEP);
  const days = step === SRS_LEARNED_STEP ? SRS_LEARNED_INTERVAL_DAYS : SRS_STEPS[step]!;
  return { step, nextReviewAt: addDays(today, days), lapses: card.lapses };
}

// --- «Сегодня» пользователя ---

interface UserToday {
  timezone: string;
  todayStr: string;
  today: Date;
}

async function getUserToday(db: Db, userId: string, now: Date): Promise<UserToday> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  });
  const todayStr = localDateStr(now, user.timezone);
  return { timezone: user.timezone, todayStr, today: dateOnlyUtc(todayStr) };
}

// --- Источники карточек (spec 7.6) ---

type SourceOutcome = "created" | "reset" | "noop";

/**
 * Единая точка источников: новая карточка — step 0, next = сегодня; поверх
 * существующей — сброс на step 0, next = завтра, lapses не трогаются (lapses
 * копит только кнопка «Не знаю»). Ручное добавление поверх живой карточки —
 * no-op (spec 7.6). DECISION: сброс от ошибки (quiz_fail/test_fail/mock)
 * перештамповывает added_from — фильтр «мои западающие» видит, что карточка
 * вернулась из-за ошибки; сброс от lesson_key провенанс не переписывает.
 */
const FAILURE_SOURCES: SrsAddedFrom[] = ["quiz_fail", "test_fail", "mock"];

async function resetExistingCard(
  db: Db,
  input: { userId: string; questionId: string; source: SrsAddedFrom; today: Date },
): Promise<SourceOutcome> {
  if (input.source === "manual") return "noop";
  await db.srsCard.update({
    where: { userId_questionId: { userId: input.userId, questionId: input.questionId } },
    data: {
      step: 0,
      nextReviewAt: addDays(input.today, 1),
      ...(FAILURE_SOURCES.includes(input.source) ? { addedFrom: input.source } : {}),
    },
  });
  return "reset";
}

async function upsertCardFromSource(
  db: Db,
  input: { userId: string; questionId: string; source: SrsAddedFrom; today: Date },
): Promise<SourceOutcome> {
  const existing = await db.srsCard.findUnique({
    where: { userId_questionId: { userId: input.userId, questionId: input.questionId } },
  });
  if (existing) return resetExistingCard(db, input);

  // ON CONFLICT DO NOTHING (createMany skipDuplicates): параллельный источник
  // (два is_key одного вопроса, двойной сабмит) мог создать карточку между
  // findUnique и вставкой — уникальный индекс (user, question) ловит гонку, НЕ
  // отравляя транзакцию вызывающего действия (в отличие от create+catch P2002,
  // где абортнутая tx роняет весь ответ квиза). count=0 ⇒ карточка уже есть.
  const created = await db.srsCard.createMany({
    data: [
      {
        userId: input.userId,
        questionId: input.questionId,
        step: 0,
        nextReviewAt: input.today,
        addedFrom: input.source,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 0) return resetExistingCard(db, input);

  await emitEvent(
    db,
    "srs.card_added",
    { questionId: input.questionId, source: input.source },
    { userId: input.userId },
  );
  return "created";
}

/** completeLesson → карточки всех is_key-вопросов урока (spec 7.6). */
export async function addSrsCardsForLessonCompletion(
  db: Db,
  input: { userId: string; lessonId: string; now?: Date },
): Promise<void> {
  const links = await db.questionLesson.findMany({
    where: { lessonId: input.lessonId, isKey: true, question: { status: "published" } },
    select: { questionId: true },
    orderBy: { createdAt: "asc" },
  });
  if (links.length === 0) return;

  const { today } = await getUserToday(db, input.userId, input.now ?? new Date());
  for (const link of links) {
    await upsertCardFromSource(db, {
      userId: input.userId,
      questionId: link.questionId,
      source: "lesson_key",
      today,
    });
  }
}

/** Неверный ответ квиза/теста (позже — отметка мока) пополняет очередь. */
export async function addSrsCardForFailure(
  db: Db,
  input: {
    userId: string;
    questionId: string;
    source: Extract<SrsAddedFrom, "quiz_fail" | "test_fail" | "mock">;
    now?: Date;
  },
): Promise<void> {
  const { today } = await getUserToday(db, input.userId, input.now ?? new Date());
  await upsertCardFromSource(db, {
    userId: input.userId,
    questionId: input.questionId,
    source: input.source,
    today,
  });
}

export type AddManualResult = { ok: true; added: boolean } | { ok: false; code: "not_found" };

/** Кнопка «В повторения» (spec 7.4): поверх живой карточки — no-op. */
export async function addSrsCardManually(
  db: Db,
  input: { userId: string; questionId: string; now?: Date },
): Promise<AddManualResult> {
  const question = await db.question.findUnique({ where: { id: input.questionId } });
  if (!question || question.status !== "published") return { ok: false, code: "not_found" };

  const { today } = await getUserToday(db, input.userId, input.now ?? new Date());
  const outcome = await upsertCardFromSource(db, {
    userId: input.userId,
    questionId: input.questionId,
    source: "manual",
    today,
  });
  return { ok: true, added: outcome === "created" };
}

// --- Дневная очередь (spec 7.6) ---

export interface SrsQueue {
  /** Дневная выборка целиком (после лимита новых), в порядке показа. */
  cards: SrsCard[];
  total: number;
  estimateMinutes: number;
}

/**
 * Новые карточки (reviews_count=0), уже отвеченные сегодня впервые, съедают
 * дневной лимит 20 — иначе закрытие первой порции открывало бы следующую
 * пачку новых и «не более 20 новых в день» не выполнялось бы.
 */
async function countNewCardsReviewedToday(
  db: Db,
  userId: string,
  todayStr: string,
  timezone: string,
): Promise<number> {
  const { start, end } = zonedDayUtcRange(todayStr, timezone);
  const reviewedToday = await db.srsReview.findMany({
    where: { card: { userId }, reviewedAt: { gte: start, lt: end } },
    select: { cardId: true },
    distinct: ["cardId"],
  });
  if (reviewedToday.length === 0) return 0;

  const reviewedBefore = await db.srsReview.findMany({
    where: { cardId: { in: reviewedToday.map((row) => row.cardId) }, reviewedAt: { lt: start } },
    select: { cardId: true },
    distinct: ["cardId"],
  });
  const seenBefore = new Set(reviewedBefore.map((row) => row.cardId));
  return reviewedToday.filter((row) => !seenBefore.has(row.cardId)).length;
}

/**
 * Выборка дня: suspended=false, вопрос published, next_review_at <= today(tz),
 * просроченные раньше (сортировка by next_review_at asc). Новых — максимум 20:
 * лишние просто не попадают в выборку, без записей сдвига в БД (spec 7.6).
 * DECISION: фильтр `question.status=published` держит из очереди/сессии
 * карточки вопросов, снятых с публикации после добавления, — иначе сессия
 * отрендерит черновик.
 */
export async function getSrsQueue(
  db: Db,
  input: { userId: string; now?: Date },
): Promise<SrsQueue> {
  const now = input.now ?? new Date();
  const { timezone, todayStr, today } = await getUserToday(db, input.userId, now);

  const due = await db.srsCard.findMany({
    where: {
      userId: input.userId,
      suspended: false,
      nextReviewAt: { lte: today },
      question: { status: "published" },
    },
    orderBy: [{ nextReviewAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  let newAllowance =
    SRS_NEW_PER_DAY - (await countNewCardsReviewedToday(db, input.userId, todayStr, timezone));
  const cards = due.filter((card) => {
    if (card.reviewsCount > 0) return true;
    if (newAllowance <= 0) return false;
    newAllowance -= 1;
    return true;
  });

  return { cards, total: cards.length, estimateMinutes: estimateQueueMinutes(cards.length) };
}

/**
 * Ближайшая дата следующих повторений — для пустого состояния очереди.
 * Учитывает новые карточки, вытесненные сегодняшним лимитом 20: они остаются
 * с next_review_at <= today (без сдвига в БД, spec 7.6), но покажутся завтра,
 * поэтому при исчерпанном лимите и наличии таких карточек ближайшая дата —
 * завтра, а не только first future-карточка.
 */
export async function getNextReviewDate(
  db: Db,
  input: { userId: string; now?: Date },
): Promise<Date | null> {
  const now = input.now ?? new Date();
  const { timezone, todayStr, today } = await getUserToday(db, input.userId, now);

  const baseWhere = {
    userId: input.userId,
    suspended: false,
    question: { status: "published" as const },
  };

  const nextFuture = await db.srsCard.findFirst({
    where: { ...baseWhere, nextReviewAt: { gt: today } },
    orderBy: { nextReviewAt: "asc" },
    select: { nextReviewAt: true },
  });
  const futureDate = nextFuture?.nextReviewAt ?? null;

  // Есть ли due-новые карточки сверх сегодняшнего лимита? Тогда завтра появится
  // хотя бы одна из них — ближайшая дата не позже завтра.
  const allowanceLeft =
    SRS_NEW_PER_DAY - (await countNewCardsReviewedToday(db, input.userId, todayStr, timezone));
  const dueNew = await db.srsCard.count({
    where: { ...baseWhere, reviewsCount: 0, nextReviewAt: { lte: today } },
  });
  const tomorrow = dueNew > Math.max(0, allowanceLeft) ? addDays(today, 1) : null;

  if (futureDate && tomorrow) return futureDate < tomorrow ? futureDate : tomorrow;
  return futureDate ?? tomorrow;
}

// --- Сессия и оценка карточки ---

export type ReviewCardResult =
  | {
      ok: true;
      prevStep: number;
      newStep: number;
      remaining: number;
      queueCompleted: boolean;
      /** Начисленный XP и достижения этого ответа — для ритуалов/тостов (spec 5.4). */
      xpAwarded: number;
      leveledUpTo: number | null;
      earnedAchievements: EarnedAchievement[];
    }
  | { ok: false; code: "not_found" | "not_due" };

/**
 * Один ответ сессии — отдельное действие (spec 7.6: выход в любой момент,
 * отвеченное сохранено). Карточка вне сегодняшней очереди отклоняется —
 * это же гасит двойной сабмит (после оценки next_review уходит в будущее).
 * queue.completed эмитится строго один раз в календарный день пользователя —
 * exactly-once держит уникальный индекс xp_events в диспетчере (spec 7.13).
 */
export async function reviewSrsCard(
  db: PrismaClient,
  input: { userId: string; cardId: string; grade: SrsGrade; now?: Date },
): Promise<ReviewCardResult> {
  const now = input.now ?? new Date();
  const card = await db.srsCard.findUnique({ where: { id: input.cardId } });
  if (!card || card.userId !== input.userId) return { ok: false, code: "not_found" };

  const { todayStr, today } = await getUserToday(db, input.userId, now);
  if (card.suspended || card.nextReviewAt > today) return { ok: false, code: "not_due" };

  const transition = applyGrade(card, input.grade, today);

  // Транзакция самого ответа (spec 7.6: отвеченное сохранено при любом выходе).
  const gamification = await db.$transaction(async (tx) => {
    await tx.srsCard.update({
      where: { id: card.id },
      data: {
        step: transition.step,
        nextReviewAt: transition.nextReviewAt,
        lapses: transition.lapses,
        reviewsCount: { increment: 1 },
        lastGrade: input.grade,
      },
    });
    await tx.srsReview.create({
      data: {
        cardId: card.id,
        grade: input.grade,
        reviewedAt: now,
        prevStep: card.step,
        newStep: transition.step,
      },
    });
    return emitEvent(
      tx,
      "card.reviewed",
      {
        cardId: card.id,
        questionId: card.questionId,
        grade: input.grade,
        prevStep: card.step,
        newStep: transition.step,
      },
      { userId: input.userId, now },
    );
  });

  // Закрытие очереди — ПОСЛЕ коммита ответа, отдельным идемпотентным эмитом.
  // Причина: при гонке двух вкладок, опустошающих последние карточки, чтение
  // внутри транзакции не видит несохранённое обновление чужой карточки — обе
  // насчитали бы remaining=1 и никто бы не заэмитил (потеря дня). Пост-коммит
  // чтение видит зафиксированные чужие карточки; уникальный индекс xp_events
  // гасит двойной эмит — строгий exactly-once (spec 7.13, закрытие огранич. этапа 4).
  const { total: remaining } = await getSrsQueue(db, { userId: input.userId, now });
  let queueCompleted = false;
  let result = gamification;
  if (remaining === 0) {
    const queueResult = await db.$transaction((tx) =>
      emitEvent(tx, "queue.completed", { day: todayStr }, { userId: input.userId, now }),
    );
    queueCompleted = queueResult.recorded;
    result = mergeEmitResults(gamification, queueResult);
  }

  return {
    ok: true,
    prevStep: card.step,
    newStep: transition.step,
    remaining,
    queueCompleted,
    xpAwarded: result.xpAwarded,
    leveledUpTo: result.leveledUpTo,
    earnedAchievements: result.earnedAchievements,
  };
}

export interface SessionCard {
  cardId: string;
  question: Question;
  category: { title: string; colorIndex: number };
  /** Привязанный урок для ссылки «Открыть урок» (is_key-привязка приоритетна). */
  lesson: { id: string; title: string } | null;
}

/** Порция сессии — первые 15 карточек дневной выборки с данными вопросов. */
export async function getSessionCards(
  db: Db,
  input: { userId: string; now?: Date },
): Promise<{ cards: SessionCard[]; queueTotal: number }> {
  const queue = await getSrsQueue(db, input);
  const portion = queue.cards.slice(0, SRS_SESSION_SIZE);
  if (portion.length === 0) return { cards: [], queueTotal: 0 };

  const questionIds = portion.map((card) => card.questionId);
  const [questions, links] = await Promise.all([
    db.question.findMany({
      where: { id: { in: questionIds } },
      include: { category: { include: { parent: { select: { colorIndex: true } } } } },
    }),
    db.questionLesson.findMany({
      where: { questionId: { in: questionIds }, lesson: { status: "published" } },
      include: { lesson: { select: { id: true, title: true } } },
      orderBy: [{ isKey: "desc" }, { createdAt: "asc" }],
    }),
  ]);
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const lessonByQuestion = new Map<string, { id: string; title: string }>();
  for (const link of links) {
    if (!lessonByQuestion.has(link.questionId)) {
      lessonByQuestion.set(link.questionId, link.lesson);
    }
  }

  return {
    cards: portion.flatMap((card) => {
      const question = questionById.get(card.questionId);
      if (!question) return [];
      return [
        {
          cardId: card.id,
          question,
          category: {
            title: question.category.title,
            colorIndex: question.category.parent?.colorIndex ?? question.category.colorIndex,
          },
          lesson: lessonByQuestion.get(card.questionId) ?? null,
        },
      ];
    }),
    queueTotal: queue.total,
  };
}

// --- Статистика и агрегаторы (/trainer; дашборд переиспользует с этапа 5) ---

export interface TrainerStats {
  answeredTotal: number;
  learnedCount: number;
  /** Доля good среди ответов за 30 дней; null, если ответов не было. */
  accuracy30: number | null;
}

export async function getTrainerStats(
  db: Db,
  input: { userId: string; now?: Date },
): Promise<TrainerStats> {
  const now = input.now ?? new Date();
  const since = addDays(now, -30);
  const [answeredTotal, learnedCount, reviews30, good30] = await Promise.all([
    db.srsReview.count({ where: { card: { userId: input.userId } } }),
    db.srsCard.count({ where: { userId: input.userId, step: SRS_LEARNED_STEP } }),
    db.srsReview.count({ where: { card: { userId: input.userId }, reviewedAt: { gte: since } } }),
    db.srsReview.count({
      where: { card: { userId: input.userId }, grade: "good", reviewedAt: { gte: since } },
    }),
  ]);
  return {
    answeredTotal,
    learnedCount,
    accuracy30: reviews30 === 0 ? null : good30 / reviews30,
  };
}

export interface LaggingCategory {
  categoryId: string;
  title: string;
  colorIndex: number;
  againShare: number;
  answers: number;
}

/**
 * «Западающие темы»: топ-3 корневых категорий по доле again за 30 дней;
 * null (блок скрыт), пока ответов меньше 20 (spec 8.3). Агрегатор общий —
 * его же возьмёт дашборд на этапе 5.
 */
export async function getLaggingCategories(
  db: Db,
  input: { userId: string; now?: Date },
): Promise<LaggingCategory[] | null> {
  const now = input.now ?? new Date();
  const reviews = await db.srsReview.findMany({
    where: { card: { userId: input.userId }, reviewedAt: { gte: addDays(now, -30) } },
    select: {
      grade: true,
      card: {
        select: {
          question: {
            select: {
              category: {
                select: {
                  id: true,
                  title: true,
                  colorIndex: true,
                  parent: { select: { id: true, title: true, colorIndex: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (reviews.length < LAGGING_MIN_ANSWERS) return null;

  const byCategory = new Map<string, LaggingCategory & { again: number }>();
  for (const review of reviews) {
    const category = review.card.question.category;
    const root = category.parent ?? category;
    const entry = byCategory.get(root.id) ?? {
      categoryId: root.id,
      title: root.title,
      colorIndex: root.colorIndex,
      againShare: 0,
      answers: 0,
      again: 0,
    };
    entry.answers += 1;
    if (review.grade === "again") entry.again += 1;
    byCategory.set(root.id, entry);
  }

  return [...byCategory.values()]
    .map(({ again, ...entry }) => ({ ...entry, againShare: again / entry.answers }))
    .filter((entry) => entry.againShare > 0)
    .sort((a, b) => b.againShare - a.againShare || b.answers - a.answers)
    .slice(0, 3);
}

/**
 * «Мои западающие» в каталоге (spec 7.4 + этап 4): вопросы, по которым есть
 * карточка с lapses ≥ 1 либо добавленная из ошибок (quiz_fail/test_fail/mock).
 */
export async function getLaggingQuestionIds(db: Db, userId: string): Promise<string[]> {
  const cards = await db.srsCard.findMany({
    where: {
      userId,
      OR: [{ lapses: { gte: 1 } }, { addedFrom: { in: ["quiz_fail", "test_fail", "mock"] } }],
    },
    select: { questionId: true },
  });
  return cards.map((card) => card.questionId);
}

/** Карточки пользователя для набора вопросов — состояние кнопки «В повторения». */
export async function getUserCardQuestionIds(
  db: Db,
  userId: string,
  questionIds: string[],
): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set();
  const cards = await db.srsCard.findMany({
    where: { userId, questionId: { in: questionIds } },
    select: { questionId: true },
  });
  return new Set(cards.map((card) => card.questionId));
}
