import type { Prisma, PrismaClient, StudySession } from "@prisma/client";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { canOpenCourse } from "@/lib/services/course-access";
import { getLessonView } from "@/lib/services/content";
import { emitEvent } from "@/lib/services/events";
import { STREAK_QUALIFYING_EVENTS } from "@/lib/services/streak";
import { formatTimeRu, localDateStr, zonedDateTimeToUtc } from "@/lib/utils/dates";
import {
  newStudyFields,
  repetitionSnapshotSchema,
  studyFieldsSchema,
  studyFlags,
  studyWeek,
  summarizeStudyWeek,
  type RepetitionSnapshot,
  type StudyCard,
  type StudyFields,
} from "@/lib/utils/study-session-summary";

export class StudySessionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (code: string, message: string): never => {
  throw new StudySessionError(code, message);
};
export const studyCommandSchema = z
  .object({
    id: z.string().min(1).max(100),
    version: z.number().int().nonnegative(),
    operation: z.enum(["save", "start", "stop", "complete", "abandon"]),
    fields: studyFieldsSchema,
  })
  .strict();
export type StudyCommand = z.infer<typeof studyCommandSchema>;
export function studyCard(row: StudySession): StudyCard {
  return {
    id: row.id,
    userId: row.userId,
    courseId: row.courseId,
    lessonId: row.lessonId,
    courseTitle: row.courseTitle,
    lessonTitle: row.lessonTitle,
    timezone: row.timezone,
    status: row.status,
    version: row.version,
    fields: studyFieldsSchema.parse(row.fields),
    repetitions: repetitionSnapshotSchema.safeParse(row.repetitions).data ?? [],
    plannedAt: row.plannedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
function plannedInstant(fields: StudyFields, timezone: string) {
  const [date, time] = fields.plannedLocal.split("T") as [string, string];
  const instant = zonedDateTimeToUtc(date, time, timezone);
  if (
    !Number.isFinite(+instant) ||
    `${localDateStr(instant, timezone)}T${formatTimeRu(instant, timezone)}` !== fields.plannedLocal
  )
    fail("validation", "Проверь дату и время занятия");
  return instant;
}
async function allowedLesson(db: Db, userId: string, lessonId: string) {
  const view = await getLessonView(db, lessonId, userId);
  if (!view?.unlocked || !(await canOpenCourse(db, userId, view.course.id)))
    return fail(
      "lesson_locked",
      "Урок удалён или недоступен. Можно сохранить рефлексию прежнего занятия.",
    );
  return view;
}
async function lockStudent(db: Db, userId: string, now: Date) {
  // One lock orders create/start/edit across tabs. The unique slot also protects DB-level callers.
  await db.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (
    !user ||
    user.role !== "student" ||
    user.status !== "active" ||
    (user.accessUntil && user.accessUntil <= now)
  )
    return fail("forbidden", "Учебные сессии сейчас недоступны");
  return user;
}
export async function createStudySession(
  db: PrismaClient,
  userId: string,
  lessonId: string | null = null,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    const user = await lockStudent(tx, userId, now);
    const active = await tx.studySession.findUnique({ where: { activeUserId: userId } });
    if (active) return studyCard(active);
    const view = lessonId ? await allowedLesson(tx, userId, lessonId) : null;
    const fields = newStudyFields(
      view?.lesson.title ?? "",
      `${localDateStr(now, user.timezone)}T${formatTimeRu(now, user.timezone)}`,
    );
    return studyCard(
      await tx.studySession.create({
        data: {
          userId,
          activeUserId: userId,
          lessonId,
          courseId: view?.course.id,
          courseTitle: view?.course.title,
          lessonTitle: view?.lesson.title,
          timezone: user.timezone,
          fields,
          plannedAt: plannedInstant(fields, user.timezone),
          createdAt: now,
        },
      }),
    );
  });
}
async function repetitionSnapshot(
  db: Db,
  userId: string,
  lessonId: string | null,
): Promise<RepetitionSnapshot[]> {
  if (!lessonId) return [];
  // Only metadata of this student's existing cards; no question text or new SRS entries.
  const cards = await db.srsCard.findMany({
    where: { userId, question: { lessonLinks: { some: { lessonId, isKey: true } } } },
    select: { id: true, questionId: true, step: true, nextReviewAt: true, suspended: true },
    orderBy: { id: "asc" },
  });
  return cards.map((c) => ({
    cardId: c.id,
    questionId: c.questionId,
    step: c.step,
    nextReviewAt: c.nextReviewAt.toISOString().slice(0, 10),
    suspended: c.suspended,
  }));
}
const reflectionKeys = [
  "startedOnTime",
  "completedBlocks",
  "distractions",
  "explain",
  "thoughts",
  "gaps",
  "nextAction",
] as const;
export async function updateStudySession(
  db: PrismaClient,
  userId: string,
  raw: StudyCommand,
  now = new Date(),
) {
  const parsed = studyCommandSchema.safeParse(raw);
  if (!parsed.success) return fail("validation", "Проверь поля карточки");
  const command = parsed.data;
  return db.$transaction(async (tx) => {
    await lockStudent(tx, userId, now);
    const row = await tx.studySession.findFirst({ where: { id: command.id, userId } });
    if (!row) return fail("not_found", "Карточка не найдена");
    if (row.version !== command.version)
      return fail(
        "conflict",
        "Карточка изменена в другой вкладке. Открой сохранённую версию; твой текст пока остаётся в форме.",
      );
    if (row.status === "abandoned") return fail("closed", "Эта сессия прервана");
    const old = studyFieldsSchema.parse(row.fields);
    // Planning facts cannot be rewritten after the actual start.
    const fields =
      row.status === "draft"
        ? command.fields
        : ({
            ...old,
            ...Object.fromEntries(reflectionKeys.map((key) => [key, command.fields[key]])),
          } as StudyFields);
    if (fields.completedBlocks !== null && fields.completedBlocks > fields.plannedBlocks)
      return fail("validation", "Завершённых блоков не может быть больше запланированных");
    const op = command.operation;
    const status = row.status;
    if (
      (op === "start" && status !== "draft") ||
      (op === "stop" && status !== "running") ||
      (op === "complete" && status !== "reflection") ||
      (op === "abandon" && status === "completed")
    )
      return fail("transition", "Обнови карточку: этот этап уже недоступен");
    if (op === "start") {
      if (!fields.topic.trim() || !fields.goal.trim())
        return fail("validation", "Укажи тему и результат занятия");
      if (row.lessonId) await allowedLesson(tx, userId, row.lessonId);
      else if (row.lessonTitle)
        return fail(
          "lesson_locked",
          "Урок удалён. Прерви черновик и создай самостоятельную сессию.",
        );
    }
    if (op === "complete" || status === "completed") {
      if (
        fields.startedOnTime === null ||
        fields.completedBlocks === null ||
        fields.distractions === null ||
        fields.explain === null ||
        fields.thoughts.some((s) => !s.trim()) ||
        !fields.nextAction.trim()
      )
        return fail(
          "validation",
          "Заполни результат, три мысли и следующий шаг. Пробелы можно оставить пустыми.",
        );
    }
    const updated = await tx.studySession.update({
      where: { id: row.id },
      data: {
        fields,
        plannedAt: plannedInstant(fields, row.timezone),
        version: { increment: 1 },
        ...(op === "start" ? { status: "running", startedAt: now } : {}),
        ...(op === "stop" ? { status: "reflection", endedAt: now } : {}),
        ...(op === "complete"
          ? {
              status: "completed",
              completedAt: now,
              activeUserId: null,
              repetitions: (await repetitionSnapshot(
                tx,
                userId,
                row.lessonId,
              )) as unknown as Prisma.InputJsonValue,
            }
          : {}),
        ...(op === "abandon"
          ? {
              status: "abandoned",
              activeUserId: null,
              endedAt: row.startedAt ? (row.endedAt ?? now) : null,
            }
          : {}),
      },
    });
    const eventSuffix = {
      save: "edited",
      start: "started",
      stop: "stopped",
      complete: "completed",
      abandon: "abandoned",
    }[op];
    if (op !== "save" || status === "completed")
      await emitEvent(
        tx,
        `study_session.${eventSuffix}`,
        { sessionId: row.id, version: updated.version },
        { userId, now },
      );
    return studyCard(updated);
  });
}
export async function getStudyCards(db: Db, userId: string) {
  return (
    await db.studySession.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    })
  ).map(studyCard);
}
export async function getActiveStudySession(db: Db, userId: string) {
  const row = await db.studySession.findUnique({ where: { activeUserId: userId } });
  return row ? studyCard(row) : null;
}
export async function getStudySessionDashboard(
  db: Db,
  userId: string,
  now: Date,
  timezone: string,
) {
  const range = studyWeek(now, timezone);
  const [activeRow, weekRows, recentRows] = await Promise.all([
    db.studySession.findUnique({ where: { activeUserId: userId } }),
    db.studySession.findMany({
      where: {
        userId,
        status: "completed",
        endedAt: { gte: range.start, lt: range.end },
      },
      orderBy: [{ endedAt: "desc" }, { id: "desc" }],
    }),
    db.studySession.findMany({
      where: { userId, status: "completed" },
      orderBy: [{ endedAt: "desc" }, { id: "desc" }],
      take: 3,
    }),
  ]);
  const active = activeRow ? studyCard(activeRow) : null;
  return {
    active,
    summary: summarizeStudyWeek(
      [...(active ? [active] : []), ...weekRows.map(studyCard)],
      now,
      timezone,
    ),
    recent: recentRows.map(studyCard),
  };
}
export async function getStudySessionReport(
  db: Db,
  userId: string,
  now = new Date(),
  week?: string,
) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true, activatedAt: true, createdAt: true },
  });
  const [cards, activity] = await Promise.all([
    getStudyCards(db, userId),
    db.analyticsEvent.findFirst({
      where: { userId, type: { in: [...STREAK_QUALIFYING_EVENTS, "mock.completed"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    cards,
    summary: summarizeStudyWeek(cards, now, user.timezone, week),
    flags: studyFlags(
      cards,
      now,
      user.timezone,
      activity?.createdAt ?? user.activatedAt ?? user.createdAt,
    ),
  };
}
/** Future worker integration: no side effects. Consumer deduplicates key and chooses recipients/channels. */
export async function prepareStudyWeeklyReport(
  db: Db,
  userId: string,
  week: string,
  now = new Date(),
) {
  const { summary } = await getStudySessionReport(db, userId, now, week);
  return {
    type: "study_session.weekly_ready" as const,
    schemaVersion: 1,
    idempotencyKey: `study-week:${userId}:${summary.week}:${summary.timezone}`,
    userId,
    summary,
    url: `/study-sessions?week=${summary.week}`,
  };
}
export async function getStudyMentorFlags(db: Db, now = new Date()) {
  const students = await db.user.findMany({
    where: {
      role: "student",
      status: "active",
      OR: [{ accessUntil: null }, { accessUntil: { gt: now } }],
    },
    select: {
      id: true,
      name: true,
      email: true,
      timezone: true,
      activatedAt: true,
      createdAt: true,
    },
  });
  const userIds = students.map((student) => student.id);
  if (userIds.length === 0) return [];
  const [sessionRows, activities] = await Promise.all([
    db.studySession.findMany({
      where: { userId: { in: userIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    db.analyticsEvent.groupBy({
      by: ["userId"],
      where: {
        userId: { in: userIds },
        type: { in: [...STREAK_QUALIFYING_EVENTS, "mock.completed"] },
      },
      _max: { createdAt: true },
    }),
  ]);
  const cardsByUser = new Map<string, StudyCard[]>();
  for (const row of sessionRows) {
    const cards = cardsByUser.get(row.userId) ?? [];
    cards.push(studyCard(row));
    cardsByUser.set(row.userId, cards);
  }
  const activityByUser = new Map(activities.map((row) => [row.userId, row._max.createdAt]));
  const rows = [];
  for (const student of students) {
    const flags = studyFlags(
      cardsByUser.get(student.id) ?? [],
      now,
      student.timezone,
      activityByUser.get(student.id) ?? student.activatedAt ?? student.createdAt,
    );
    for (const flag of flags)
      rows.push({ ...flag, studentId: student.id, studentName: student.name || student.email });
  }
  return rows.sort(
    (a, b) =>
      Number(b.severity === "red") - Number(a.severity === "red") ||
      a.studentName.localeCompare(b.studentName, "ru"),
  );
}
