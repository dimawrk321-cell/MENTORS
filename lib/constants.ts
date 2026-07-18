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

// --- Stage 7: library (spec 7.9) — client-safe labels + business constants ---

/**
 * Этап собеседования в карточке — строчными, как в acceptance-флоу 10
 * («лайфкодинг · NLP · middle»). Значения enum RecordingStage (spec 6).
 */
export const RECORDING_STAGE_LABEL: Record<string, string> = {
  screening: "скрининг",
  theory: "теория",
  livecoding: "лайфкодинг",
  soft: "софт",
  final: "финал",
};

export const RECORDING_DIRECTION_LABEL: Record<string, string> = {
  ds: "DS",
  nlp: "NLP",
  ai: "AI",
  classic_ml: "Classic ML",
};

export const RECORDING_GRADE_LABEL: Record<string, string> = {
  junior: "junior",
  middle: "middle",
  senior: "senior",
};

export const RECORDING_OUTCOME_LABEL: Record<string, string> = {
  offer: "Оффер",
  reject: "Отказ",
  unknown: "Исход неизвестен",
};

export const COMPANY_TYPE_LABEL: Record<string, string> = {
  bigtech: "Бигтех",
  fintech: "Финтех",
  product: "Продуктовая",
  startup: "Стартап",
};

/** Порядок значений для фильтров каталога (spec 7.9). */
export const RECORDING_STAGES = ["screening", "theory", "livecoding", "soft", "final"] as const;
export const RECORDING_DIRECTIONS = ["ds", "nlp", "ai", "classic_ml"] as const;
export const RECORDING_GRADES = ["junior", "middle", "senior"] as const;
export const RECORDING_OUTCOMES = ["offer", "reject", "unknown"] as const;
export const COMPANY_TYPES = ["bigtech", "fintech", "product", "startup"] as const;

/**
 * Карточка записи (spec 7.9): title = «{Этап} · {Направление} · {грейд}» —
 * анонимизированный ярлык, который видит ученик (реальный `title` — админ-поле).
 */
export function recordingCardTitle(input: {
  stage: string;
  direction: string;
  grade: string;
}): string {
  const stage = RECORDING_STAGE_LABEL[input.stage] ?? input.stage;
  const direction = RECORDING_DIRECTION_LABEL[input.direction] ?? input.direction;
  const grade = RECORDING_GRADE_LABEL[input.grade] ?? input.grade;
  return `${stage} · ${direction} · ${grade}`;
}

/**
 * Чеклист анонимизации (spec 7.9): все четыре обязательны для публикации —
 * дисциплина, встроенная в интерфейс. Ключи = поля recordings.checklist.
 */
export const RECORDING_CHECKLIST_ITEMS = [
  { key: "faces", label: "Лица скрыты" },
  { key: "voice", label: "Голос изменён" },
  { key: "names", label: "Имена и названия вырезаны" },
  { key: "consent", label: "Согласие донора получено" },
] as const;

export type RecordingChecklistKey = (typeof RECORDING_CHECKLIST_ITEMS)[number]["key"];

/**
 * true только когда отмечены все четыре пункта чеклиста (гейт публикации).
 * Принимает `unknown` — checklist приходит и как typed-объект, и как Prisma Json.
 */
export function isChecklistComplete(checklist: unknown): boolean {
  if (!checklist || typeof checklist !== "object") return false;
  const c = checklist as Record<string, unknown>;
  return RECORDING_CHECKLIST_ITEMS.every((item) => c[item.key] === true);
}

/** Ссылка на Я.Диск считается устаревшей после стольких дней (spec 7.9). */
export const LINK_STALE_DAYS = 30;

/**
 * true, когда ссылка старше LINK_STALE_DAYS (spec 7.9). Единая точка для счётчика
 * в шапке и подсветки строки — без неё они расходились из-за разного округления.
 */
export function isLinkStale(linkUpdatedAt: Date, now: Date | number = Date.now()): boolean {
  const nowMs = typeof now === "number" ? now : now.getTime();
  return (nowMs - linkUpdatedAt.getTime()) / (24 * 60 * 60 * 1000) > LINK_STALE_DAYS;
}

/** Предупреждение на странице просмотра (spec 7.9): личный доступ. */
export const RECORDING_ACCESS_WARNING =
  "Запись доступна лично тебе. Передача ссылки — нарушение условий доступа.";

// --- Stage 7: guides (spec 7.10) — client-safe labels ---

/** Русские названия секций справочника (spec 7.10). Порядок = порядок сайдбара. */
export const GUIDE_SECTION_LABEL: Record<string, string> = {
  tools: "Инструменты индустрии",
  resume: "Резюме",
  legend: "Легенда",
  stages: "Этапы собеседований",
  ask_interviewer: "Вопросы интервьюеру",
  job_search: "Поиск работы",
};

export const GUIDE_SECTIONS = [
  "tools",
  "resume",
  "legend",
  "stages",
  "ask_interviewer",
  "job_search",
] as const;

// --- Stage 8: search & CommandPalette (spec 7.11) — client-safe ---

/** Сложность урока (spec 6: intro|base|advanced) — чип и мета поиска. */
export const LESSON_DIFFICULTY_LABEL: Record<string, string> = {
  intro: "интро",
  base: "база",
  advanced: "продвинутый",
};

/** Заголовки групп результатов (spec 7.11). «Действия» — клиентские, не из API. */
export const SEARCH_GROUP_LABEL: Record<string, string> = {
  lessons: "Уроки",
  questions: "Вопросы",
  guides: "Гайды",
  recordings: "Записи",
};

/** Порядок групп в палитре (spec 7.11: Уроки · Вопросы · Гайды · Записи). */
export const SEARCH_GROUP_ORDER = ["lessons", "questions", "guides", "recordings"] as const;

/** Валидация запроса (spec 7.11): от 2 до 100 символов; лимит 5 на группу. */
export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_QUERY = 100;
export const SEARCH_GROUP_LIMIT = 5;
/** Клиентский дебаунс перед /api/search (spec 7.11). */
export const SEARCH_DEBOUNCE_MS = 150;
/** «Недавнее» (spec 7.11): хранится последних 20, показывается 5. */
export const RECENT_KEEP = 20;
export const RECENT_SHOW = 5;

// --- Stage 10: analytics (spec 8.5) — client-safe period selector ---

/** Период-селектор аналитики (spec 8.5): 7/30/90 дней. */
export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

// --- Stage 11: importer (/admin/import, spec 7.14/8.5) — client-safe ---

/** Лимит размера md-файла экспорта (spec 7.14: «до 25 МБ»). */
export const IMPORT_MAX_MD_MB = 25;
/** Лимит размера опционального zip с картинками. */
export const IMPORT_MAX_ZIP_MB = 100;

/** Русские подписи фаз выполнения импорта (поллинг статуса джобы). */
export const IMPORT_RUN_STATUS_LABEL: Record<string, string> = {
  pending: "В очереди",
  parsing: "Разбор файла",
  planning: "Построение плана",
  committing: "Запись в базу",
  done: "Готово",
  error: "Ошибка",
};

/** Незавершённые статусы прогона — для индикатора «идёт импорт». */
export const IMPORT_RUN_ACTIVE_STATUSES = ["pending", "parsing", "planning", "committing"] as const;

/** Подписи строк отчёта (создано/пропущено по типам) — совпадают с CLI-отчётом. */
export const IMPORT_COUNT_LABEL: Record<string, string> = {
  courses: "Курсы",
  modules: "Модули",
  lessons: "Уроки",
  categories: "Категории вопросов",
  questions: "Вопросы (банк)",
  keyQuestions: "Вопросы «Проверка себя»",
  keyLinks: "Привязки ключевых (is_key)",
  categoryLinks: "Привязки по «Категориям…»",
  guides: "Гайды (справочник)",
};

/** Порядок строк счётчиков в отчёте (совпадает с CLI). */
export const IMPORT_COUNT_ORDER = [
  "courses",
  "modules",
  "lessons",
  "categories",
  "questions",
  "keyQuestions",
  "keyLinks",
  "categoryLinks",
  "guides",
] as const;

/** Подписи типов аномалий отчёта импортера (spec 7.14 п.6). */
export const IMPORT_ANOMALY_LABEL: Record<string, string> = {
  questionsAtSubcategoryLevel: "Вопросы не на своём уровне",
  unrecognizedCategoryLinks: "Нераспознанные категории",
  needsLatex: "needs_latex (ответ был картинкой)",
  todoImages: "TODO-изображения",
  skippedSections: "Пропущенные разделы",
  createdNonSeedRootCategories: "Новые корневые категории",
};
