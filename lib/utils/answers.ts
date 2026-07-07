// Auto-checked answers (spec 7.4/7.5): closed question types for quizzes and
// module tests. Pure functions — unit-tested.

export interface QuestionOptionData {
  id: string;
  text: string;
  correct: boolean;
}

export interface CheckableQuestion {
  type: "open" | "single" | "multi" | "tf" | "short_text";
  options?: unknown; // Json column: QuestionOptionData[]
  acceptedAnswers?: unknown; // Json column: string[]
}

/** Spec 7.4 short_text: trim → lower → ё=е → схлопывание пробелов. */
export function normalizeShortText(input: string): string {
  return input.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

export function parseOptions(options: unknown): QuestionOptionData[] {
  if (!Array.isArray(options)) return [];
  return options.filter(
    (option): option is QuestionOptionData =>
      typeof option === "object" &&
      option !== null &&
      typeof (option as QuestionOptionData).id === "string" &&
      typeof (option as QuestionOptionData).text === "string" &&
      typeof (option as QuestionOptionData).correct === "boolean",
  );
}

export function parseAcceptedAnswers(accepted: unknown): string[] {
  if (!Array.isArray(accepted)) return [];
  return accepted.filter((item): item is string => typeof item === "string");
}

/**
 * Answer payload shapes (stored as-is in quiz_answers/test_attempt_answers):
 * single|tf → optionId: string; multi → optionIds: string[]; short_text → string.
 * Open questions are never auto-checked (they are not in quizzes/tests).
 */
export function checkAnswer(question: CheckableQuestion, answer: unknown): boolean {
  switch (question.type) {
    case "single":
    case "tf": {
      if (typeof answer !== "string") return false;
      const options = parseOptions(question.options);
      return options.some((option) => option.id === answer && option.correct);
    }
    case "multi": {
      if (!Array.isArray(answer)) return false;
      const chosen = new Set(answer.filter((id): id is string => typeof id === "string"));
      const options = parseOptions(question.options);
      const correct = options.filter((option) => option.correct);
      if (correct.length === 0) return false;
      return chosen.size === correct.length && correct.every((option) => chosen.has(option.id));
    }
    case "short_text": {
      if (typeof answer !== "string") return false;
      const normalized = normalizeShortText(answer);
      if (!normalized) return false;
      return parseAcceptedAnswers(question.acceptedAnswers).some(
        (accepted) => normalizeShortText(accepted) === normalized,
      );
    }
    case "open":
      return false;
  }
}

/** Закрытые (автопроверяемые) типы — пул квизов и тестов (spec 7.4). */
export const CLOSED_QUESTION_TYPES = ["single", "multi", "tf", "short_text"] as const;
