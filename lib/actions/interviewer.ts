"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  addAvailabilityException,
  addAvailabilityRule,
  deleteAvailabilityException,
  deleteAvailabilityRule,
} from "@/lib/services/slots";
import {
  cancelBookingByInterviewer,
  closeDay,
  completeMock,
  markNoShow,
  saveNotes,
  setQuestionMark,
} from "@/lib/services/mocks";
import { publishFeedback, saveFeedbackDraft } from "@/lib/services/feedback";
import { upsertInterviewerProfile } from "@/lib/services/mock-admin";
import { writeAudit } from "@/lib/services/audit";
import {
  ActionError,
  assertNotImpersonating,
  parseInput,
  requireActionInterviewer,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  availabilityExceptionSchema,
  availabilityRuleSchema,
  bookingIdSchema,
  closeDaySchema,
  deleteExceptionSchema,
  deleteRuleSchema,
  feedbackDraftSchema,
  interviewerProfileSchema,
  questionMarkSchema,
  saveNotesSchema,
} from "@/lib/utils/validation";

// Interviewer-cabinet actions (spec 8.4/9). Guarded by requireActionInterviewer
// (is_interviewer flag); значимые конфиг- и мок-мутации — в аудите (spec 11).

function revalidateSchedule(): void {
  revalidatePath("/interviewer/schedule");
}

function revalidateRun(bookingId: string): void {
  revalidatePath(`/interviewer/run/${bookingId}`);
  revalidatePath("/interviewer/bookings");
}

// --- Расписание доступности (spec 8.4) ---

export async function addRuleAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(availabilityRuleSchema, input);
    const res = await addAvailabilityRule(prisma, { interviewerId: auth.user.id, ...parsed });
    if (!res.ok) throw new ActionError(res.code, "Некорректное окно доступности");
    await writeAudit(prisma, {
      actorId: auth.user.id,
      action: "availability.rule_added",
      entityType: "availability_rule",
      entityId: auth.user.id,
      after: parsed,
    });
    revalidateSchedule();
    return undefined;
  });
}

export async function deleteRuleAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(deleteRuleSchema, input);
    await deleteAvailabilityRule(prisma, { interviewerId: auth.user.id, ruleId: parsed.ruleId });
    await writeAudit(prisma, {
      actorId: auth.user.id,
      action: "availability.rule_deleted",
      entityType: "availability_rule",
      entityId: parsed.ruleId,
    });
    revalidateSchedule();
    return undefined;
  });
}

export async function addExceptionAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(availabilityExceptionSchema, input);
    const res = await addAvailabilityException(prisma, {
      interviewerId: auth.user.id,
      date: parsed.date,
      kind: parsed.kind,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
    });
    if (!res.ok) throw new ActionError(res.code, "Некорректное исключение");
    await writeAudit(prisma, {
      actorId: auth.user.id,
      action: "availability.exception_added",
      entityType: "availability_exception",
      entityId: auth.user.id,
      after: parsed,
    });
    revalidateSchedule();
    return undefined;
  });
}

export async function deleteExceptionAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(deleteExceptionSchema, input);
    await deleteAvailabilityException(prisma, {
      interviewerId: auth.user.id,
      exceptionId: parsed.exceptionId,
    });
    revalidateSchedule();
    return undefined;
  });
}

export async function closeDayAction(input: unknown): Promise<ActionResult<{ cancelled: number }>> {
  return runAction(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(closeDaySchema, input);
    const res = await closeDay(prisma, { interviewerId: auth.user.id, date: parsed.date });
    await writeAudit(prisma, {
      actorId: auth.user.id,
      action: "availability.day_closed",
      entityType: "user",
      entityId: auth.user.id,
      after: { date: parsed.date, cancelled: res.cancelled, closed: res.closed },
    });
    revalidateSchedule();
    revalidatePath("/interviewer/bookings");
    return { cancelled: res.cancelled };
  });
}

// --- Экран проведения (spec 7.8/8.4) ---

export async function saveNotesAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(saveNotesSchema, input);
    // Autosave (spec 7.8) — не аудируется (как автосейвы контента, changelog 7.13).
    const res = await saveNotes(prisma, {
      interviewerId: auth.user.id,
      bookingId: parsed.bookingId,
      text: parsed.text,
    });
    if (!res.ok) throw new ActionError(res.code, "Бронь не найдена");
    return undefined;
  });
}

export async function setQuestionMarkAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(questionMarkSchema, input);
    const res = await setQuestionMark(prisma, {
      interviewerId: auth.user.id,
      bookingId: parsed.bookingId,
      questionId: parsed.questionId,
      mark: parsed.mark,
    });
    if (!res.ok) throw new ActionError(res.code, "Бронь не найдена");
    return undefined;
  });
}

export async function markNoShowAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(bookingIdSchema, input);
    const res = await markNoShow(prisma, {
      interviewerId: auth.user.id,
      bookingId: parsed.bookingId,
    });
    if (!res.ok) {
      const messages: Record<typeof res.code, string> = {
        not_found: "Бронь не найдена",
        too_early: "«Не пришёл» станет активна через 10 минут после старта",
        not_bookable: "Эту бронь уже нельзя отметить",
      };
      throw new ActionError(res.code, messages[res.code]);
    }
    await writeAudit(prisma, {
      actorId: auth.user.id,
      action: "mock.no_show",
      entityType: "booking",
      entityId: parsed.bookingId,
    });
    revalidateRun(parsed.bookingId);
    revalidatePath("/mocks/mine");
    return undefined;
  });
}

export async function completeMockAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(bookingIdSchema, input);
    const res = await completeMock(prisma, {
      interviewerId: auth.user.id,
      bookingId: parsed.bookingId,
    });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "not_completable" ? "Мок уже завершён или отменён" : "Бронь не найдена",
      );
    }
    await writeAudit(prisma, {
      actorId: auth.user.id,
      action: "mock.completed",
      entityType: "booking",
      entityId: parsed.bookingId,
    });
    revalidateRun(parsed.bookingId);
    revalidatePath("/mocks/mine");
    revalidatePath("/");
    return undefined;
  });
}

export async function cancelByInterviewerAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(bookingIdSchema, input);
    const res = await cancelBookingByInterviewer(prisma, {
      interviewerId: auth.user.id,
      bookingId: parsed.bookingId,
    });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "not_cancellable" ? "Эту бронь уже нельзя отменить" : "Бронь не найдена",
      );
    }
    await writeAudit(prisma, {
      actorId: auth.user.id,
      action: "mock.cancelled_by_interviewer",
      entityType: "booking",
      entityId: parsed.bookingId,
    });
    revalidatePath("/interviewer/bookings");
    revalidatePath("/mocks/mine");
    return undefined;
  });
}

// --- Фидбек (spec 7.8) ---

export async function saveFeedbackDraftAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(feedbackDraftSchema, input);
    const res = await saveFeedbackDraft(prisma, {
      interviewerId: auth.user.id,
      bookingId: parsed.bookingId,
      data: {
        scores: parsed.scores,
        verdict: parsed.verdict,
        strengths: parsed.strengths,
        growth: parsed.growth,
        recommendedLessonIds: parsed.recommendedLessonIds,
      },
    });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "already_published"
          ? "Фидбек уже опубликован — правки недоступны"
          : "Бронь не найдена",
      );
    }
    return undefined;
  });
}

export async function publishFeedbackAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    const parsed = parseInput(bookingIdSchema, input);
    const res = await publishFeedback(prisma, {
      interviewerId: auth.user.id,
      bookingId: parsed.bookingId,
    });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "already_published" ? "Фидбек уже опубликован" : "Сначала сохрани фидбек",
      );
    }
    await writeAudit(prisma, {
      actorId: auth.user.id,
      action: "feedback.published",
      entityType: "booking",
      entityId: parsed.bookingId,
    });
    revalidateRun(parsed.bookingId);
    revalidatePath("/mocks/mine");
    return undefined;
  });
}

// --- Свой профиль интервьюера (spec 8.4): room_url, bio, active ---

export async function updateOwnProfileAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionInterviewer();
    assertNotImpersonating(auth);
    // userId форсируется на себя — интервьюер редактирует только свой профиль.
    const parsed = parseInput(interviewerProfileSchema, {
      ...(typeof input === "object" && input !== null ? input : {}),
      userId: auth.user.id,
    });
    const res = await upsertInterviewerProfile(prisma, {
      actorId: auth.user.id,
      userId: auth.user.id,
      roomUrl: parsed.roomUrl,
      bio: parsed.bio ?? null,
      active: parsed.active,
    });
    if (!res.ok) throw new ActionError(res.code, "Профиль интервьюера недоступен");
    revalidateSchedule();
    return undefined;
  });
}
