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
      throw new ActionError(res.code, res.code === "locked" ? "Урок ещё закрыт" : "Урок не найден");
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
