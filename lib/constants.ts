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
