"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  completeLesson,
  getFirstLessonOfTrack,
  reportContent,
  saveOnboarding,
  savePosition,
  selectLearningPath,
  startLesson,
} from "@/lib/services/content";
import {
  ActionError,
  assertActiveAccess,
  assertNotImpersonating,
  parseInput,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { onboardingSchema, reportContentSchema, savePositionSchema } from "@/lib/utils/validation";
import { toFeedback, type GamificationFeedback } from "@/lib/gamification";
import { touchRecentItem } from "@/lib/services/recent";
import { completeLessonStep, saveLessonStepPosition } from "@/lib/services/lesson-steps";

/** Fired once on lesson open; impersonation views must not fake student activity. */
export async function startLessonAction(lessonId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    if (auth.impersonated || auth.accessExpired) return undefined; // silent no-op
    const id = parseInput(z.string().min(1), lessonId);
    await startLesson(prisma, { userId: auth.user.id, lessonId: id });
    // Recency index for the palette (spec 7.11) — every open bumps it.
    await touchRecentItem(prisma, { userId: auth.user.id, itemType: "lesson", entityId: id });
    return undefined;
  });
}

export async function completeLessonAction(lessonId: string): Promise<
  ActionResult<{
    nextLessonId: string | null;
    courseSlug: string;
    gamification: GamificationFeedback;
  }>
> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const res = await completeLesson(prisma, {
      userId: auth.user.id,
      lessonId: parseInput(z.string().min(1), lessonId),
    });
    if (!res.ok) {
      const messages: Record<typeof res.code, string> = {
        locked: "Урок ещё закрыт",
        // Block 2v2: the chain is enforced in the service, so a crafted request
        // cannot complete a lesson inside a course the student may not open.
        course_locked: "Курс ещё закрыт",
        path_required: "Сначала выбери: смотреть видео или читать текст",
        not_found: "Урок не найден",
      };
      throw new ActionError(res.code, messages[res.code]);
    }
    return {
      nextLessonId: res.nextLessonId,
      courseSlug: res.courseSlug,
      gamification: toFeedback(res),
    };
  });
}

/** Debounced reading positions; silently skipped in read-only/expired states. */
export async function savePositionAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    if (auth.impersonated || auth.accessExpired) return undefined;
    const parsed = parseInput(savePositionSchema, input);
    await savePosition(prisma, {
      userId: auth.user.id,
      lessonId: parsed.lessonId,
      scrollPos: parsed.scroll,
      videoPos: parsed.video,
    });
    return undefined;
  });
}

export async function completeLessonStepAction(
  input: unknown,
): Promise<ActionResult<{ nextStepId: string | null; lessonCompleted: boolean }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(
      z.object({ lessonId: z.string().min(1), stepId: z.string().min(1) }),
      input,
    );
    const result = await completeLessonStep(prisma, { userId: auth.user.id, ...parsed });
    if (!result.ok) {
      const messages: Record<typeof result.code, string> = {
        not_found: "Шаг не найден",
        locked: "Урок ещё закрыт",
        course_locked: "Курс ещё закрыт",
        path_required: "Сначала выбери: смотреть видео или читать текст",
        previous_step_required: "Сначала заверши предыдущий шаг",
      };
      throw new ActionError(result.code, messages[result.code]);
    }
    return { nextStepId: result.nextStepId, lessonCompleted: result.lessonCompleted };
  });
}

export async function saveLessonStepPositionAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    if (auth.impersonated || auth.accessExpired) return undefined;
    const parsed = parseInput(
      z.object({ stepId: z.string().min(1), scroll: z.number().min(0).max(1) }),
      input,
    );
    await saveLessonStepPosition(prisma, {
      userId: auth.user.id,
      stepId: parsed.stepId,
      scrollPos: parsed.scroll,
    });
  });
}

export async function selectLearningPathAction(
  lessonId: string,
  path: "video" | "text",
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    if (auth.impersonated || auth.accessExpired) return undefined;
    const ok = await selectLearningPath(prisma, {
      userId: auth.user.id,
      lessonId: parseInput(z.string().min(1), lessonId),
      path: parseInput(z.enum(["video", "text"]), path),
    });
    if (!ok) {
      throw new ActionError("invalid_lesson_path", "Этот путь для урока недоступен");
    }
    return undefined;
  });
}

export async function reportContentAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(reportContentSchema, input);
    await reportContent(prisma, {
      userId: auth.user.id,
      lessonId: parsed.lessonId,
      type: parsed.type,
      text: parsed.text,
    });
    return undefined;
  });
}

/** Onboarding (spec 8.2): track + goal + digest time, then the first track lesson. */
export async function saveOnboardingAction(input: unknown): Promise<ActionResult<undefined>> {
  let target: string | null = null;

  const result = await runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(onboardingSchema, input);
    await saveOnboarding(prisma, {
      userId: auth.user.id,
      // Walk 12.4: the student picks their own name on the first onboarding screen.
      name: parsed.name,
      track: parsed.track,
      dailyGoalXp: parsed.dailyGoalXp,
      digestTime: parsed.digestTime,
    });
    const firstLesson = await getFirstLessonOfTrack(prisma, parsed.track);
    target = firstLesson ? `/lessons/${firstLesson}` : "/";
    return undefined;
  });

  if (result.ok && target) redirect(target);
  return result;
}
