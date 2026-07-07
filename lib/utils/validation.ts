import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "@/lib/utils/password";

// Zod schemas for stage-1 actions. Messages are user-facing Russian (spec 9:
// action errors carry ready-to-toast Russian text).

export const emailSchema = z
  .string("Укажи email")
  .trim()
  .toLowerCase()
  .pipe(z.email("Некорректный email"));

export const passwordSchema = z
  .string("Укажи пароль")
  .min(PASSWORD_MIN_LENGTH, `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов`)
  .max(256, "Пароль слишком длинный");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string("Укажи пароль").min(1, "Укажи пароль"),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
  consent: z.literal("on", "Нужно согласиться с правилами доступа"),
});

export const requestResetSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  oldPassword: z.string("Укажи текущий пароль").min(1, "Укажи текущий пароль"),
  newPassword: passwordSchema,
});

export const inviteStudentSchema = z.object({
  email: emailSchema,
  name: z.string("Укажи имя").trim().min(1, "Укажи имя").max(100, "Имя слишком длинное"),
});

export const extendAccessSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("days"),
    userId: z.string().min(1),
    days: z.number().int().positive(),
    comment: z.string().trim().max(500).optional(),
  }),
  z.object({
    kind: z.literal("until"),
    userId: z.string().min(1),
    // <input type="date"> value, e.g. «2026-10-05»
    date: z.iso.date("Укажи дату"),
    comment: z.string().trim().max(500).optional(),
  }),
]);
