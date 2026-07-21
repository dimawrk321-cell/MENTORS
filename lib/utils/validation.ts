import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "@/lib/utils/password";
import { ALL_PERMISSIONS, type Permission } from "@/lib/constants";

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

/** Приглашение ментора (spec 2: назначать роли — owner). is_interviewer опционально. */
export const inviteMentorSchema = z.object({
  email: emailSchema,
  name: z.string("Укажи имя").trim().min(1, "Укажи имя").max(100, "Имя слишком длинное"),
  isInterviewer: z.boolean().default(false),
});

// --- Walk 12.4: credential-based access & team (spec 7.1, 2/8.5) ---

/**
 * Optional name at account creation (walk 12.4): «при создании имя опционально».
 * Empty is allowed — the student sets their name on onboarding. Prefills it when
 * the admin knows it. Only max-length is enforced here.
 */
const createNameSchema = z.string().trim().max(50, "Имя слишком длинное").optional().default("");

/** «Выдать доступ» (walk 12.4/A1): email = login, name optional. */
export const issueCredentialsSchema = z.object({
  email: emailSchema,
  name: createNameSchema,
});

/** «Добавить участника» (walk 12.4/B4): staff role + optional interviewer flag. */
export const createTeamMemberSchema = z.object({
  email: emailSchema,
  name: createNameSchema,
  role: z.enum(["mentor", "admin"], "Выбери роль"),
  isInterviewer: z.boolean().default(false),
});

/** Forced initial password (walk 12.4/A2): new password only — session-authed. */
export const setInitialPasswordSchema = z.object({ password: passwordSchema });

const permissionKeySchema = z
  .string()
  .refine((v): v is Permission => (ALL_PERMISSIONS as string[]).includes(v), "Неизвестное право");

/** Team member role change (walk 12.4/B3, owner-only). */
export const teamRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["mentor", "admin"], "Выбери роль"),
});

/**
 * Team member permission override (walk 12.4/B1, owner-only). `null` clears the
 * override (back to the role preset); an array is the explicit effective set.
 */
export const teamPermissionsSchema = z.object({
  userId: z.string().min(1),
  permissions: z.array(permissionKeySchema).max(ALL_PERMISSIONS.length).nullable(),
});

/** Team member interviewer flag (walk 12.4/B3, owner-only). */
export const teamInterviewerSchema = z.object({
  userId: z.string().min(1),
  isInterviewer: z.boolean(),
});

// Changelog этапа 3: is_key и in_quiz взаимоисключающие — ключевой вопрос
// раскрывает эталон в блоке урока и не может одновременно быть вопросом квиза.
export const QUESTION_LINK_ROLE_ERROR =
  "Вопрос не может быть одновременно ключевым и в квизе — выбери одну роль";

export function isValidQuestionLinkFlags(flags: { isKey: boolean; inQuiz: boolean }): boolean {
  return !(flags.isKey && flags.inQuiz);
}

export const questionLinkSchema = z
  .object({
    questionId: z.string().min(1),
    lessonId: z.string().min(1),
    isKey: z.boolean(),
    inQuiz: z.boolean(),
  })
  .refine(isValidQuestionLinkFlags, QUESTION_LINK_ROLE_ERROR);

export const reportContentSchema = z.object({
  lessonId: z.string().min(1),
  type: z.enum(["error", "unclear"], "Выбери тип обращения"),
  text: z.string().trim().max(1000, "Слишком длинный комментарий").optional(),
});

export const savePositionSchema = z.object({
  lessonId: z.string().min(1),
  scroll: z.number().min(0).max(1).optional(),
  video: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60)
    .optional(),
});

/** Student name (walk 12.4): 2–50 chars, any characters. Онбординг + профиль. */
export const nameSchema = z
  .string("Как тебя зовут?")
  .trim()
  .min(2, "Имя — от 2 до 50 символов")
  .max(50, "Имя — от 2 до 50 символов");

export const onboardingSchema = z.object({
  // Walk 12.4: the student picks their own name on the (new) first screen.
  name: nameSchema,
  track: z.enum(["ds", "nlp", "ai"]).nullable(),
  dailyGoalXp: z.union([z.literal(30), z.literal(60), z.literal(120)]),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Укажи время в формате ЧЧ:ММ"),
});

/** Profile name edit (walk 12.4): «имя редактируется в профиле». */
export const updateNameSchema = z.object({ name: nameSchema });

export const reviewCardSchema = z.object({
  cardId: z.string().min(1),
  grade: z.enum(["again", "hard", "good"]),
});

// --- Stage 6: mocks (spec 7.8) ---

const timeSchema = z
  .string("Укажи время")
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Укажи время в формате ЧЧ:ММ");

export const mockTypeSchema = z.enum(["theory", "legend"], "Выбери тип мока");

export const bookMockSchema = z.object({
  slotId: z.string().min(1),
  type: mockTypeSchema,
});

export const bookingIdSchema = z.object({ bookingId: z.string().min(1) });

export const joinWaitlistSchema = z.object({
  type: mockTypeSchema,
  interviewerId: z.string().min(1).nullable().optional(),
});

export const claimOfferSchema = z.object({ waitlistId: z.string().min(1) });

export const availabilityRuleSchema = z
  .object({
    weekday: z.number().int().min(1, "День недели 1–7").max(7, "День недели 1–7"),
    startTime: timeSchema,
    endTime: timeSchema,
  })
  .refine((v) => v.startTime < v.endTime, {
    message: "Начало окна должно быть раньше конца",
    path: ["endTime"],
  });

export const deleteRuleSchema = z.object({ ruleId: z.string().min(1) });

export const availabilityExceptionSchema = z
  .object({
    date: z.iso.date("Укажи дату"),
    kind: z.enum(["day_off", "extra"], "Выбери тип исключения"),
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
  })
  .refine((v) => v.kind === "day_off" || (v.startTime && v.endTime && v.startTime < v.endTime), {
    message: "Для дополнительного окна укажи корректные начало и конец",
    path: ["endTime"],
  });

export const deleteExceptionSchema = z.object({ exceptionId: z.string().min(1) });

export const closeDaySchema = z.object({ date: z.iso.date("Укажи дату") });

export const saveNotesSchema = z.object({
  bookingId: z.string().min(1),
  text: z.string().max(20000),
});

export const questionMarkSchema = z.object({
  bookingId: z.string().min(1),
  questionId: z.string().min(1),
  mark: z.enum(["answered", "partial", "failed"]).nullable(),
});

export const feedbackDraftSchema = z.object({
  bookingId: z.string().min(1),
  scores: z.record(z.string(), z.number().int().min(1).max(5)),
  verdict: z.enum(["ready", "needs_work", "not_ready"], "Выбери вердикт"),
  strengths: z.string().max(5000).default(""),
  growth: z.string().max(5000).default(""),
  recommendedLessonIds: z.array(z.string().min(1)).max(50).default([]),
});

export const interviewerProfileSchema = z.object({
  userId: z.string().min(1),
  roomUrl: z.url("Укажи корректную ссылку на комнату").max(500),
  bio: z.string().trim().max(1000).nullable().optional(),
  active: z.boolean(),
});

export const rubricTemplateSchema = z.object({
  type: mockTypeSchema,
  criteria: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[a-z0-9_]+$/, "Ключ критерия — латиница, цифры, «_»"),
        title: z.string().trim().min(1, "Укажи название критерия").max(120),
      }),
    )
    .min(1, "Добавь хотя бы один критерий")
    .max(20),
});

export const removeStrikeSchema = z.object({ strikeId: z.string().min(1) });

// --- Stage 7: library & guides (spec 7.9 / 7.10) ---

const recordingChecklistSchema = z.object({
  faces: z.boolean(),
  voice: z.boolean(),
  names: z.boolean(),
  consent: z.boolean(),
});

/**
 * Recording create/update (spec 7.9). Publication gate is a refinement: status
 * may be `published` only when all four checklist items are true — the same
 * discipline the «Опубликовать» button enforces client-side (defense in depth).
 */
export const recordingUpsertSchema = z
  .object({
    id: z.string().min(1).nullable().optional(),
    title: z
      .string("Укажи название")
      .trim()
      .min(1, "Укажи название")
      .max(200, "Слишком длинное название"),
    stage: z.enum(["screening", "theory", "livecoding", "soft", "final"], "Выбери этап"),
    direction: z.enum(["ds", "nlp", "ai", "classic_ml"], "Выбери направление"),
    grade: z.enum(["junior", "middle", "senior"], "Выбери грейд"),
    outcome: z.enum(["offer", "reject", "unknown"]),
    companyType: z.enum(["bigtech", "fintech", "product", "startup"], "Выбери тип компании"),
    durationMinutes: z
      .number("Укажи длительность")
      .int()
      .min(1, "Длительность должна быть положительной")
      .max(600, "Слишком большая длительность"),
    url: z.url("Укажи корректную ссылку на запись").max(1000),
    embedUrl: z
      .union([z.literal(""), z.url("Некорректная ссылка для встраивания")])
      .transform((value) => value || null),
    checklist: recordingChecklistSchema,
    status: z.enum(["draft", "published"]),
  })
  .refine(
    (v) =>
      v.status !== "published" ||
      (v.checklist.faces && v.checklist.voice && v.checklist.names && v.checklist.consent),
    {
      message: "Опубликовать можно только когда отмечены все четыре пункта чеклиста",
      path: ["status"],
    },
  );

export const recordingIdSchema = z.object({ recordingId: z.string().min(1) });

const guideSectionSchema = z.enum(
  ["tools", "resume", "legend", "stages", "ask_interviewer", "job_search"],
  "Выбери секцию",
);

export const createGuideSchema = z.object({
  section: guideSectionSchema,
  title: z
    .string("Укажи название")
    .trim()
    .min(1, "Укажи название")
    .max(200, "Слишком длинное название"),
});

export const guideMetaSchema = z.object({
  guideId: z.string().min(1),
  title: z
    .string("Укажи название")
    .trim()
    .min(1, "Укажи название")
    .max(200, "Слишком длинное название"),
  slug: z
    .string("Укажи адрес страницы")
    .trim()
    .regex(/^[a-z0-9-]{1,80}$/, "Адрес — латиница, цифры и дефисы"),
  section: guideSectionSchema,
  order: z.number().int().min(0).max(10000),
});

export const saveGuideContentSchema = z.object({
  guideId: z.string().min(1),
  contentMd: z.string().max(300_000, "Слишком большой документ"),
});

export const toggleBookmarkSchema = z.object({ guideId: z.string().min(1) });

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

// --- Stage 9: notifications, quiet hours, announcements (spec 7.12/8.5) ---

/** «HH:MM» 24h time (digest_time, quiet hours). */
export const hhmmSchema = z
  .string("Укажи время")
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ");

export const notificationSettingsSchema = z.object({
  digestTime: hhmmSchema,
  quietHoursStart: hhmmSchema,
  quietHoursEnd: hhmmSchema,
  // Toggleable matrix — only channels the type actually exposes are honored
  // server-side; extra keys are ignored (updateNotificationPrefs clamps).
  prefs: z.record(
    z.string(),
    z.object({ inapp: z.boolean().optional(), email: z.boolean().optional() }),
  ),
});

export const createAnnouncementSchema = z
  .object({
    title: z
      .string("Укажи заголовок")
      .trim()
      .min(1, "Укажи заголовок")
      .max(200, "Слишком длинный заголовок"),
    bodyMd: z
      .string("Добавь текст")
      .trim()
      .min(1, "Добавь текст")
      .max(10_000, "Слишком длинный текст"),
    kind: z.enum(["banner", "notification"]),
    // "all" | "mock_this_week" | "course:{id}"
    segment: z
      .string()
      .refine(
        (s) => s === "all" || s === "mock_this_week" || /^course:.+/.test(s),
        "Некорректный сегмент",
      ),
    // <input type="datetime-local"> / date values; empty startsAt ⇒ now (action fills).
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
  })
  .refine((v) => !(v.endsAt && v.startsAt && v.endsAt <= v.startsAt), {
    message: "Дата окончания должна быть позже начала",
    path: ["endsAt"],
  });

export const dismissBannerSchema = z.object({ announcementId: z.string().min(1) });

// --- Stage 10.2: admin settings (spec 8.5) ---

export const updateSettingsSchema = z.object({
  // Может быть пустым — тогда контакт продления фоллбэчит на env.
  renewalContact: z.string().trim().max(300, "Слишком длинно"),
  accessRulesText: z
    .string("Добавь текст правил")
    .trim()
    .min(1, "Добавь текст правил")
    .max(5000, "Слишком длинный текст"),
  defaultCourseGating: z.enum(["strict", "recommended", "free"]),
});

// --- Stage 12.1 ---

/** Quick theme toggle (spec 12.1/B1). Persists users.theme (source of truth). */
export const themeSchema = z.object({ theme: z.enum(["system", "dark", "light"], "Выбери тему") });

/** Reading font size for lesson/guide prose (spec 12.1/C9). */
export const readingFontSizeSchema = z.object({
  size: z.enum(["s", "m", "l"], "Выбери размер"),
});

/** Per-student section access toggle (spec 12.1/C3): library / resume / legend. */
export const sectionAccessSchema = z.object({
  userId: z.string().min(1),
  section: z.enum(["library", "resume", "legend"]),
  enabled: z.boolean(),
});

/** Email verification code (spec 12.1/C8): exactly 6 digits. */
export const verifyEmailSchema = z.object({
  code: z
    .string("Введи код")
    .trim()
    .regex(/^\d{6}$/, "Код — 6 цифр"),
});

/** XP map editor (spec 12.1/C1): each value an integer 0–10000. */
export const xpMapSchema = z.object({
  map: z.record(
    z.string(),
    z
      .number("Укажи целое число")
      .int("Только целое число")
      .min(0, "Не меньше 0")
      .max(10000, "Не больше 10000"),
  ),
});

/** Operational rules editor (spec 12.1/C2): numeric values + default digest time. */
export const operationalSettingsSchema = z.object({
  values: z.record(z.string(), z.number("Укажи число").int("Только целое число")),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Укажи время в формате ЧЧ:ММ"),
});
