"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  bookMock,
  cancelBooking,
  claimOffer,
  joinWaitlist,
  transferBooking,
} from "@/lib/services/mocks";
import {
  ActionError,
  assertActiveAccess,
  assertNotImpersonating,
  parseInput,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  bookMockSchema,
  bookingIdSchema,
  claimOfferSchema,
  joinWaitlistSchema,
  transferBookingSchema,
} from "@/lib/utils/validation";

// Student mock actions (spec 9): book / cancel / joinWaitlist / claimOffer.
// Все проходят через сервисный слой (spec 3); мутации ученика недоступны в
// impersonation (read-only) и при истёкшем доступе (soft-lock).

function revalidateMocks(bookingId?: string): void {
  revalidatePath("/mocks");
  revalidatePath("/mocks/mine");
  revalidatePath("/mocks/book");
  revalidatePath("/");
  if (bookingId) revalidatePath(`/mocks/${bookingId}`);
}

const BOOK_ERROR: Record<string, string> = {
  slot_taken: "Слот только что заняли — выбери другой",
  past: "Этот слот уже начался — выбери другой",
  beyond_access: "Слот позже окончания твоего доступа — выбери более ранний",
  already_booked: "У тебя уже есть активная бронь — сначала заверши или отмени её",
  locked: "Бронирование пока недоступно из-за страйков — открой /mocks, чтобы увидеть дату",
  held: "Слот придержан для другого ученика — выбери другой",
  no_room: "У интервьюера пока не настроена комната — выбери другого",
  not_found: "Не получилось забронировать — попробуй ещё раз",
};

export async function bookMockAction(input: unknown): Promise<ActionResult<{ bookingId: string }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(bookMockSchema, input);
    const res = await bookMock(prisma, {
      userId: auth.user.id,
      slotId: parsed.slotId,
      type: parsed.type,
    });
    if (!res.ok) throw new ActionError(res.code, BOOK_ERROR[res.code] ?? BOOK_ERROR.not_found!);
    revalidateMocks(res.bookingId);
    return { bookingId: res.bookingId };
  });
}

export async function cancelBookingAction(
  input: unknown,
): Promise<ActionResult<{ late: boolean; strikeIssued: boolean }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(bookingIdSchema, input);
    const res = await cancelBooking(prisma, { userId: auth.user.id, bookingId: parsed.bookingId });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "not_cancellable" ? "Эту бронь уже нельзя отменить" : "Бронь не найдена",
      );
    }
    revalidateMocks(parsed.bookingId);
    return { late: res.late, strikeIssued: res.strikeIssued };
  });
}

const TRANSFER_ERROR: Record<string, string> = {
  not_found: "Бронь для переноса не найдена",
  not_transferable: "Эту бронь уже нельзя перенести",
  same_slot: "Это твой текущий слот — выбери другое время",
  slot_taken: "Слот только что заняли — выбери другой",
  past: "Этот слот уже начался — выбери другой",
  beyond_access: "Слот позже окончания твоего доступа — выбери более ранний",
  already_booked: "У тебя уже есть другая активная бронь",
  held: "Слот придержан для другого ученика — выбери другой",
  no_room: "У интервьюера пока не настроена комната — выбери другого",
  locked: "Перенос пока недоступен из-за страйков — открой /mocks, чтобы увидеть дату",
};

/** «Перенести» (changelog 13.4 block 3): атомарная замена брони на новый слот. */
export async function transferBookingAction(
  input: unknown,
): Promise<ActionResult<{ bookingId: string; late: boolean; strikeIssued: boolean }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(transferBookingSchema, input);
    const res = await transferBooking(prisma, {
      userId: auth.user.id,
      bookingId: parsed.bookingId,
      newSlotId: parsed.slotId,
    });
    if (!res.ok) {
      throw new ActionError(res.code, TRANSFER_ERROR[res.code] ?? TRANSFER_ERROR.not_found!);
    }
    revalidateMocks(res.newBookingId);
    return { bookingId: res.newBookingId, late: res.late, strikeIssued: res.strikeIssued };
  });
}

export async function joinWaitlistAction(
  input: unknown,
): Promise<ActionResult<{ created: boolean }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(joinWaitlistSchema, input);
    const res = await joinWaitlist(prisma, {
      userId: auth.user.id,
      type: parsed.type,
      interviewerId: parsed.interviewerId ?? null,
    });
    if (!res.ok) throw new ActionError(res.code, "Не получилось встать в лист ожидания");
    revalidateMocks();
    return { created: res.created };
  });
}

export async function claimOfferAction(
  input: unknown,
): Promise<ActionResult<{ bookingId: string }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(claimOfferSchema, input);
    const res = await claimOffer(prisma, { userId: auth.user.id, waitlistId: parsed.waitlistId });
    if (!res.ok) {
      const messages: Record<typeof res.code, string> = {
        not_found: "Предложение не найдено",
        expired: "Время на бронирование этого слота истекло",
        slot_taken: "Слот уже занят — жди следующего предложения",
        already_booked: "У тебя уже есть активная бронь",
        locked: "Бронирование пока заблокировано из-за страйков",
      };
      throw new ActionError(res.code, messages[res.code]);
    }
    revalidateMocks(res.bookingId);
    return { bookingId: res.bookingId };
  });
}
