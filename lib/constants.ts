// Client-safe shared constants (no node imports — client components use these).

// DECISION: «+1 месяц» / «+3 месяца» are 30/90 days — access_extensions.days is
// day-granular by schema (spec 6), calendar months would not fit the field.
export const EXTENSION_MONTH_DAYS = 30;

export const QUESTION_TYPE_LABEL: Record<string, string> = {
  open: "Открытый",
  single: "Один вариант",
  multi: "Несколько вариантов",
  tf: "Верно / неверно",
  short_text: "Короткий ответ",
};

export const QUESTION_DIFFICULTY_LABEL: Record<number, string> = {
  1: "лёгкий",
  2: "средний",
  3: "сложный",
};

// --- Stage 6: mocks (spec 7.8) — client-safe labels + business constants ---

export const MOCK_TYPE_LABEL: Record<string, string> = {
  theory: "ML-теория",
  legend: "По легенде",
};

export const MOCK_TYPE_DESCRIPTION: Record<string, string> = {
  theory: "Теоретическое интервью: базовый ML, метрики и валидация, DL, NLP и трансформеры.",
  legend: "Интервью по легенде: связность истории, детали проектов, каверзные вопросы.",
};

export const MOCK_VERDICT_LABEL: Record<string, string> = {
  ready: "Готов",
  needs_work: "Нужно подтянуть",
  not_ready: "Пока не готов",
};

export const MOCK_MARK_LABEL: Record<string, string> = {
  answered: "Ответил",
  partial: "Частично",
  failed: "Нет",
};

export const BOOKING_STATUS_LABEL: Record<string, string> = {
  booked: "Забронирован",
  completed: "Проведён",
  cancelled_student: "Отменён учеником",
  cancelled_interviewer: "Отменён интервьюером",
  no_show: "Неявка",
};

export const STRIKE_REASON_LABEL: Record<string, string> = {
  late_cancel: "Поздняя отмена",
  no_show: "Неявка",
};

// Параметры моков (spec 7.8). Длительность 60 + буфер 15 → сетка 75 мин.
export const MOCK_DURATION_MINUTES = 60;
export const MOCK_BUFFER_MINUTES = 15;
export const SLOT_GRID_MINUTES = MOCK_DURATION_MINUTES + MOCK_BUFFER_MINUTES; // 75
/** Горизонт материализации слотов и предпросмотра расписания (spec 7.8). */
export const SLOT_HORIZON_DAYS = 14;
export const SCHEDULE_PREVIEW_DAYS = 14;
/** Бесплатная отмена — не позже чем за столько часов до старта (spec 7.8). */
export const CANCEL_FREE_HOURS = 24;
/** «Подключиться» / «Не пришёл» окна относительно старта (spec 7.8). */
export const CONNECT_LEAD_MINUTES = 15;
export const RUN_ACCESS_LEAD_MINUTES = 15;
export const NO_SHOW_AFTER_MINUTES = 10;
/** Страйки и лок (spec 7.8): 2 страйка за скользящие 60 дней → лок 14 дней. */
export const STRIKE_THRESHOLD = 2;
export const STRIKE_WINDOW_DAYS = 60;
export const STRIKE_LOCK_DAYS = 14;
/** Waitlist (spec 7.8): заявка живёт 14 дней, hold предложения — 2 часа. */
export const WAITLIST_TTL_DAYS = 14;
export const OFFER_HOLD_HOURS = 2;

/** Правила брони одной строкой (spec 7.8) — показывается на шаге подтверждения. */
export const BOOKING_RULES_LINE =
  "Отмена бесплатна за 24 часа. Поздняя отмена или неявка — страйк; два страйка — пауза брони 14 дней";

/** Сид-плейсхолдер комнаты интервьюера: профиль ещё не заполнен настоящей ссылкой. */
export const ROOM_URL_PLACEHOLDER = "https://telemost.yandex.ru/PLACEHOLDER-замени-в-кабинете";

/**
 * Готова ли комната к подключению (spec 7.8, acceptance-фикс): непустая ссылка,
 * не сид-плейсхолдер. Пустой/плейсхолдерный room_url → бронь разрешена, но кнопка
 * «Подключиться» показывает «Комната не указана», а не мёртвую ссылку.
 */
export function isRoomUrlReady(url: string | null | undefined): boolean {
  return !!url && url.trim().length > 0 && !url.includes("PLACEHOLDER");
}
