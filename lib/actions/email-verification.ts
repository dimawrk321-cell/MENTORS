"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { resendEmailCode, verifyEmailCode } from "@/lib/services/email-verification";
import {
  ActionError,
  assertNotImpersonating,
  parseInput,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { verifyEmailSchema } from "@/lib/utils/validation";

// Soft email verification actions (spec 12.1/C8). Student-only; impersonation is
// read-only. Nothing blocks — these just flip email_verified_at / re-send the code.

const VERIFY_MESSAGE: Record<string, string> = {
  no_code: "Код не найден — запроси новый",
  expired: "Код истёк — запроси новый",
  too_many: "Слишком много попыток — запроси новый код",
  invalid: "Неверный код",
  already_verified: "Почта уже подтверждена",
  not_found: "Пользователь не найден",
};

export async function verifyEmailAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    const { code } = parseInput(verifyEmailSchema, input);
    const res = await verifyEmailCode(prisma, auth.user.id, code);
    if (!res.ok) {
      throw new ActionError(res.code, VERIFY_MESSAGE[res.code] ?? "Не удалось подтвердить");
    }
    // Clear the banner across the whole student zone + refresh the profile form.
    revalidatePath("/", "layout");
    revalidatePath("/profile");
    return undefined;
  });
}

const RESEND_MESSAGE: Record<string, string> = {
  cooldown: "Код можно запросить раз в минуту — подожди немного",
  already_verified: "Почта уже подтверждена",
  not_found: "Пользователь не найден",
};

export async function resendEmailCodeAction(): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    const res = await resendEmailCode(prisma, auth.user.id);
    if (!res.ok) {
      throw new ActionError(res.code, RESEND_MESSAGE[res.code] ?? "Не удалось отправить код");
    }
    return undefined;
  });
}
