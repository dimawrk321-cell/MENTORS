import { Prisma, type FeedbackVerdict, type MockType, type PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import { emitEvent } from "@/lib/services/events";
import { enqueueNotification } from "@/lib/services/notifications";

// Рубрики и фидбек моков (spec 7.8). Критерии рубрики — rubric_templates[type]
// (дефолты — сид/константа ниже, редактируются в админке). Черновик фидбека
// автосейвится; «Опубликовать» эмитит feedback.published (достижения
// ready_theory/ready_legend + уведомление ученику) и открывает страницу фидбека.

export interface RubricCriterion {
  key: string;
  title: string;
}

/** Дефолтные критерии рубрик (spec 7.8). Сидятся в rubric_templates, здесь —
 *  источник истины и фолбэк, если шаблон в БД отсутствует. */
export const DEFAULT_RUBRIC_CRITERIA: Record<MockType, RubricCriterion[]> = {
  theory: [
    { key: "base_ml", title: "Базовый ML" },
    { key: "metrics", title: "Метрики и валидация" },
    { key: "ensembles", title: "Ансамбли" },
    { key: "dl_basics", title: "DL-основы" },
    { key: "nlp_transformers", title: "NLP и трансформеры" },
    { key: "communication", title: "Структура и коммуникация ответов" },
  ],
  legend: [
    { key: "story_coherence", title: "Связность истории" },
    { key: "project_depth", title: "Глубина деталей проектов" },
    { key: "tough_questions", title: "Устойчивость к каверзным вопросам" },
    { key: "resume_match", title: "Соответствие резюме" },
    { key: "confidence", title: "Уверенность подачи" },
  ],
};

function parseCriteria(value: unknown): RubricCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item && typeof item === "object" && "key" in item && "title" in item) {
      const key = (item as Record<string, unknown>).key;
      const title = (item as Record<string, unknown>).title;
      if (typeof key === "string" && typeof title === "string") return [{ key, title }];
    }
    return [];
  });
}

/** Критерии рубрики типа: из БД, иначе дефолт (spec 7.8). */
export async function getRubricCriteria(db: Db, type: MockType): Promise<RubricCriterion[]> {
  const template = await db.rubricTemplate.findUnique({ where: { type } });
  const fromDb = template ? parseCriteria(template.criteria) : [];
  return fromDb.length > 0 ? fromDb : DEFAULT_RUBRIC_CRITERIA[type];
}

/** Сид/апдейт шаблона рубрики (spec 18/8.5). */
export async function upsertRubricTemplate(
  db: Db,
  input: { type: MockType; criteria: RubricCriterion[] },
): Promise<void> {
  const criteria = input.criteria as unknown as Prisma.InputJsonValue;
  await db.rubricTemplate.upsert({
    where: { type: input.type },
    create: { type: input.type, criteria },
    update: { criteria },
  });
}

export async function seedRubricTemplates(db: Db): Promise<void> {
  for (const type of ["theory", "legend"] as const) {
    await upsertRubricTemplate(db, { type, criteria: DEFAULT_RUBRIC_CRITERIA[type] });
  }
}

// --- Черновик и публикация фидбека ---

export interface FeedbackDraftInput {
  scores: Record<string, number>;
  verdict: FeedbackVerdict;
  strengths: string;
  growth: string;
  recommendedLessonIds: string[];
}

/** Нормализует оценки: только ключи критериев рубрики, значения 1–5. */
function sanitizeScores(
  scores: Record<string, number>,
  criteria: RubricCriterion[],
): Record<string, number> {
  const allowed = new Set(criteria.map((c) => c.key));
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(scores)) {
    if (!allowed.has(key)) continue;
    const n = Math.round(Number(value));
    if (Number.isFinite(n) && n >= 1 && n <= 5) clean[key] = n;
  }
  return clean;
}

export type FeedbackResult = { ok: true } | { ok: false; code: "not_found" | "already_published" };

/** Автосейв черновика фидбека (spec 7.8). Создаёт строку при первом сохранении. */
export async function saveFeedbackDraft(
  db: Db,
  input: { interviewerId: string; bookingId: string; data: FeedbackDraftInput },
): Promise<FeedbackResult> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { slot: { select: { interviewerId: true } }, feedback: { select: { status: true } } },
  });
  if (!booking || booking.slot.interviewerId !== input.interviewerId) {
    return { ok: false, code: "not_found" };
  }
  if (booking.feedback?.status === "published") return { ok: false, code: "already_published" };

  const criteria = await getRubricCriteria(db, booking.type);
  const data = {
    scores: sanitizeScores(input.data.scores, criteria),
    verdict: input.data.verdict,
    strengths: input.data.strengths.slice(0, 5000),
    growth: input.data.growth.slice(0, 5000),
    recommendedLessonIds: input.data.recommendedLessonIds.slice(0, 50),
  };

  await db.feedback.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      interviewerId: input.interviewerId,
      scores: data.scores,
      verdict: data.verdict,
      strengths: data.strengths,
      growth: data.growth,
      recommendedLessonIds: data.recommendedLessonIds,
      status: "draft",
    },
    update: {
      scores: data.scores,
      verdict: data.verdict,
      strengths: data.strengths,
      growth: data.growth,
      recommendedLessonIds: data.recommendedLessonIds,
    },
  });
  return { ok: true };
}

/**
 * «Опубликовать» фидбек (spec 7.8): status=published, уведомление ученику
 * «Фидбек по моку готов», эмит feedback.published (userId = ученик) → достижения
 * ready_theory/ready_legend по вердикту. Идемпотентно (draft → published один раз).
 */
export async function publishFeedback(
  db: PrismaClient,
  input: { interviewerId: string; bookingId: string; now?: Date },
): Promise<FeedbackResult> {
  const now = input.now ?? new Date();
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { slot: { select: { interviewerId: true } }, feedback: true },
  });
  if (!booking || booking.slot.interviewerId !== input.interviewerId || !booking.feedback) {
    return { ok: false, code: "not_found" };
  }
  if (booking.feedback.status === "published") return { ok: false, code: "already_published" };

  await db.$transaction(async (tx) => {
    await tx.feedback.update({
      where: { bookingId: booking.id },
      data: { status: "published", publishedAt: now },
    });
    await emitEvent(
      tx,
      "feedback.published",
      { bookingId: booking.id, type: booking.type, verdict: booking.feedback!.verdict },
      { userId: booking.userId, now },
    );
    await enqueueNotification(tx, {
      userId: booking.userId,
      type: "mock_feedback",
      title: "Фидбек по моку готов",
      url: `/mocks/${booking.id}`,
    });
  });
  return { ok: true };
}

// --- Форма фидбека (интервьюер) и опубликованный вид (ученик) ---

export interface FeedbackFormData {
  bookingType: MockType;
  criteria: RubricCriterion[];
  draft: {
    scores: Record<string, number>;
    verdict: FeedbackVerdict;
    strengths: string;
    growth: string;
    recommendedLessonIds: string[];
    status: "draft" | "published";
  } | null;
  /** Опубликованные уроки для мультиселекта рекомендаций. */
  lessons: Array<{ id: string; title: string; courseTitle: string }>;
}

function scoresRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Данные формы RubricForm на экране проведения (spec 7.8). */
export async function getFeedbackFormData(
  db: Db,
  input: { interviewerId: string; bookingId: string },
): Promise<FeedbackFormData | null> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { slot: { select: { interviewerId: true } }, feedback: true },
  });
  if (!booking || booking.slot.interviewerId !== input.interviewerId) return null;

  const [criteria, lessons] = await Promise.all([
    getRubricCriteria(db, booking.type),
    db.lesson.findMany({
      where: {
        status: "published",
        module: { status: "published", course: { status: "published" } },
      },
      select: {
        id: true,
        title: true,
        module: { select: { course: { select: { title: true } } } },
      },
      orderBy: [{ module: { course: { order: "asc" } } }, { order: "asc" }],
    }),
  ]);

  return {
    bookingType: booking.type,
    criteria,
    draft: booking.feedback
      ? {
          scores: scoresRecord(booking.feedback.scores),
          verdict: booking.feedback.verdict,
          strengths: booking.feedback.strengths,
          growth: booking.feedback.growth,
          recommendedLessonIds: stringArray(booking.feedback.recommendedLessonIds),
          status: booking.feedback.status,
        }
      : null,
    lessons: lessons.map((l) => ({ id: l.id, title: l.title, courseTitle: l.module.course.title })),
  };
}

export interface PublishedFeedbackView {
  verdict: FeedbackVerdict;
  strengths: string;
  growth: string;
  criteria: Array<{ key: string; title: string; score: number | null }>;
  recommendedLessons: Array<{ id: string; title: string }>;
  questionMarks: Array<{ questionId: string; textMd: string; mark: string }>;
}

/** Опубликованный фидбек для ученика (spec 7.8): рубрика барами, тексты, уроки, отметки. */
export async function getPublishedFeedback(
  db: Db,
  input: { userId: string; bookingId: string },
): Promise<PublishedFeedbackView | null> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { feedback: true },
  });
  if (!booking || booking.userId !== input.userId || !booking.feedback) return null;
  if (booking.feedback.status !== "published") return null;

  const criteriaDefs = await getRubricCriteria(db, booking.type);
  const scores = scoresRecord(booking.feedback.scores);
  const lessonIds = stringArray(booking.feedback.recommendedLessonIds);

  const [lessons, marks] = await Promise.all([
    lessonIds.length > 0
      ? db.lesson.findMany({
          where: { id: { in: lessonIds }, status: "published" },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    db.mockQuestionMark.findMany({
      where: { bookingId: booking.id },
      include: { question: { select: { textMd: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const lessonById = new Map(lessons.map((l) => [l.id, l]));

  return {
    verdict: booking.feedback.verdict,
    strengths: booking.feedback.strengths,
    growth: booking.feedback.growth,
    criteria: criteriaDefs.map((c) => ({
      key: c.key,
      title: c.title,
      score: scores[c.key] ?? null,
    })),
    recommendedLessons: lessonIds.flatMap((id) => {
      const lesson = lessonById.get(id);
      return lesson ? [{ id: lesson.id, title: lesson.title }] : [];
    }),
    questionMarks: marks.map((m) => ({
      questionId: m.questionId,
      textMd: m.question.textMd,
      mark: m.mark,
    })),
  };
}
