"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { answerQuizQuestion } from "@/lib/services/questions";
import { answerTestQuestion, finishTestAttempt, startTestAttempt } from "@/lib/services/tests";
import { advanceChainIfCourseComplete, getCourseView } from "@/lib/services/content";
import { canOpenCourse } from "@/lib/services/course-access";
import {
  ActionError,
  assertActiveAccess,
  assertNotImpersonating,
  parseInput,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { toFeedback, type GamificationFeedback } from "@/lib/gamification";

// Student quiz & test actions (spec 7.5). Availability by gating is enforced
// HERE (server-side) via the content service — tests.ts deliberately does not
// import content.ts (content consumes its gating hook), the action layer is
// the meeting point.

const answerSchema = z.union([z.string().max(2000), z.array(z.string().max(100)).max(50)]);

/**
 * Block 2v2 guards. Every student write below belongs to a course, and the
 * course chain is enforced HERE — the page guard is cosmetic, the action is the
 * boundary. Three lookups because the client hands us three different ids.
 */
async function assertCourseOpenForLesson(userId: string, lessonId: string): Promise<void> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { module: { select: { courseId: true } } },
  });
  if (!lesson) throw new ActionError("not_found", "Урок не найден");
  if (!(await canOpenCourse(prisma, userId, lesson.module.courseId))) {
    throw new ActionError("locked", "Курс ещё закрыт");
  }
}

async function assertCourseOpenForAttempt(userId: string, attemptId: string): Promise<void> {
  const attempt = await prisma.testAttempt.findUnique({
    where: { id: attemptId },
    select: { userId: true, module: { select: { courseId: true } } },
  });
  // Ownership stays finishTestAttempt's job; here we only re-resolve the course
  // so an attempt started before a lock cannot be answered or banked after it.
  if (!attempt || attempt.userId !== userId) return;
  if (!(await canOpenCourse(prisma, userId, attempt.module.courseId))) {
    throw new ActionError("locked", "Курс ещё закрыт");
  }
}

const quizInputSchema = z.object({
  lessonId: z.string().min(1),
  questionId: z.string().min(1),
  answer: answerSchema,
});

export async function answerQuizAction(
  input: unknown,
): Promise<ActionResult<{ correct: boolean; first: boolean; gamification: GamificationFeedback }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(quizInputSchema, input);
    // Block 2v2: the quiz pays XP, counts a streak day and seeds SRS cards, so
    // it is a progress write like any other — an already-open page must not keep
    // earning after the course is locked.
    await assertCourseOpenForLesson(auth.user.id, parsed.lessonId);
    const result = await answerQuizQuestion(prisma, {
      userId: auth.user.id,
      lessonId: parsed.lessonId,
      questionId: parsed.questionId,
      answer: parsed.answer,
    });
    if (!result.ok) throw new ActionError(result.code, "Вопрос не найден в квизе урока");
    return { correct: result.correct, first: result.first, gamification: toFeedback(result) };
  });
}

const startTestSchema = z.object({
  moduleId: z.string().min(1),
  kind: z.enum(["module", "testout"]),
});

/** Проверка доступности по гейтингу + старт/резюм попытки. */
export async function startTestAction(
  input: unknown,
): Promise<ActionResult<{ attemptId: string }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(startTestSchema, input);

    const mod = await prisma.module.findUnique({
      where: { id: parsed.moduleId },
      include: { course: { select: { slug: true, gating: true, status: true } } },
    });
    if (!mod || mod.status !== "published" || mod.course.status !== "published") {
      throw new ActionError("not_found", "Модуль не найден");
    }
    const courseView = await getCourseView(prisma, mod.course.slug, auth.user.id);
    const moduleState = courseView?.state.modules.get(mod.id);
    if (!moduleState) throw new ActionError("not_found", "Модуль не найден");
    // Block 2v2: the chain gates the whole course. Test-out matters most here —
    // it is deliberately available WITHOUT finishing the lessons, so without
    // this check a locked strict course could be closed straight from a URL.
    if (!(await canOpenCourse(prisma, auth.user.id, courseView!.course.id))) {
      throw new ActionError("locked", "Курс ещё закрыт");
    }
    const lessonsDone = moduleState.completedRequired === moduleState.totalRequired;

    if (parsed.kind === "module" && !lessonsDone) {
      throw new ActionError("locked", "Сначала заверши уроки модуля");
    }
    if (parsed.kind === "testout") {
      // Spec 7.3: экстерн — на незачтённом strict-модуле, пока обычный тест
      // недоступен (уроки не завершены). Иначе — обычный экзамен.
      if (mod.course.gating !== "strict") {
        throw new ActionError(
          "not_applicable",
          "Экстерн доступен только в курсах со строгим порядком",
        );
      }
      if (lessonsDone) {
        throw new ActionError("not_applicable", "Уроки уже пройдены — сдай обычный модульный тест");
      }
    }

    const result = await startTestAttempt(prisma, {
      userId: auth.user.id,
      moduleId: parsed.moduleId,
      kind: parsed.kind,
    });
    if (!result.ok) {
      const messages: Record<typeof result.code, string> = {
        no_test: "У модуля нет теста",
        disabled: "Тест модуля выключен",
        testout_disabled: "Экстерн по этому модулю выключен",
        no_questions: "В модуле пока нет вопросов для теста",
        cooldown: "Пересдача ещё на кулдауне — попробуй позже",
        already_passed: "Тест уже сдан",
      };
      throw new ActionError(result.code, messages[result.code]);
    }
    return { attemptId: result.attemptId };
  });
}

const answerTestSchema = z.object({
  attemptId: z.string().min(1),
  questionId: z.string().min(1),
  answer: answerSchema,
});

export async function answerTestAction(
  input: unknown,
): Promise<ActionResult<{ answered: number; total: number }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(answerTestSchema, input);
    await assertCourseOpenForAttempt(auth.user.id, parsed.attemptId);
    const result = await answerTestQuestion(prisma, {
      userId: auth.user.id,
      attemptId: parsed.attemptId,
      questionId: parsed.questionId,
      answer: parsed.answer,
    });
    if (!result.ok) {
      const messages: Record<typeof result.code, string> = {
        not_found: "Попытка не найдена",
        finished: "Попытка уже завершена",
        foreign_question: "Вопрос не из этой попытки",
        already_answered: "Ответ уже записан",
      };
      throw new ActionError(result.code, messages[result.code]);
    }
    return { answered: result.answered, total: result.total };
  });
}

export async function finishTestAction(attemptId: string): Promise<
  ActionResult<{
    score: number;
    passed: boolean;
    threshold: number;
    gamification: GamificationFeedback;
    /** Block 2v2: set when banking this test finished the course and opened the next. */
    unlockedCourseTitle: string | null;
  }>
> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsedAttemptId = parseInput(z.string().min(1), attemptId);
    await assertCourseOpenForAttempt(auth.user.id, parsedAttemptId);
    const result = await finishTestAttempt(prisma, {
      userId: auth.user.id,
      attemptId: parsedAttemptId,
    });
    if (!result.ok) {
      throw new ActionError(
        result.code,
        result.code === "finished" ? "Попытка уже завершена" : "Попытка не найдена",
      );
    }

    // Block 2v2: a module test can be a course's LAST outstanding requirement,
    // and that completion never passes through completeLesson. Without this the
    // chain would stop dead on any course whose final step is a test.
    let unlockedCourseTitle: string | null = null;
    if (result.passed) {
      const attempt = await prisma.testAttempt.findUnique({
        where: { id: parsedAttemptId },
        select: { module: { select: { course: { select: { slug: true } } } } },
      });
      if (attempt) {
        unlockedCourseTitle = await advanceChainIfCourseComplete(prisma, {
          userId: auth.user.id,
          courseSlug: attempt.module.course.slug,
        });
      }
    }

    return {
      score: result.score,
      passed: result.passed,
      threshold: result.threshold,
      gamification: toFeedback(result),
      unlockedCourseTitle,
    };
  });
}
