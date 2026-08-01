import type { Db } from "@/lib/db";
import { matchCategoryName, normalizeName } from "@/lib/services/notion-import/categories";

// Second pass of question→lesson linking (walk 13.6, block 3v2). The importer's
// hint-based pass is exhausted (six lessons, all in Python + PyTorch), so this
// one matches by NAME: a lesson or its module against a question-bank category.
//
// Deliberately the SAME matcher the importer uses (matchCategoryName) — one
// fuzzy rule for the whole platform, so a name that linked during import links
// the same way here.

export type MatchConfidence = "высокая" | "средняя" | "низкая";

// --- Token matching ---
//
// The importer's `matchCategoryName` compares whole NAMES, which is right for
// its input (an export node titled «Python» against a seed category «Python»).
// Here the left-hand side is a lesson title — a sentence — so name equality
// almost never fires: on the stand it matched 6 lessons out of 82.
//
// So names first (still the importer's rule, unchanged), then a token overlap:
// how much of the CATEGORY's meaningful vocabulary appears in the lesson title.
// «Функции, области видимости, подводные камни» covers all of «Подводные камни»;
// «Коллекции: списки, кортежи, словари» covers all of «Списки и кортежи» and all
// of «Словари». That is the signal a human would use, and the review table shows
// the matched words so a wrong guess is obvious at a glance.

const STOPWORDS = new Set([
  "и",
  "в",
  "на",
  "для",
  "с",
  "со",
  "по",
  "о",
  "об",
  "к",
  "из",
  "а",
  "или",
  "все",
  "весь",
  "это",
  "как",
  "что",
  "при",
  "не",
  "the",
  "and",
  "of",
  "for",
  "to",
  "a",
  "in",
  // Structural words that carry no topic: they would match everything.
  "основы",
  "основной",
  "введение",
  "обзор",
  "теория",
  "практика",
  "часть",
  "этап",
  "вопросы",
  "тема",
  "темы",
  "урок",
  "модуль",
  "курс",
]);

/** Crude Russian stemmer: enough to make «статистики» ≡ «статистика». */
function stem(token: string): string {
  return token.replace(
    /(ами|ями|ого|его|ой|ей|ая|яя|ые|ие|ов|ев|ам|ям|ах|ях|ы|и|а|я|о|е|у|ю|й)$/u,
    "",
  );
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/ё/g, "е")
      .split(/[^a-zа-я0-9]+/u)
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
      .map(stem)
      .filter((word) => word.length >= 3),
  );
}

interface TokenMatch {
  coverage: number;
  matched: string[];
}

/** How much of the category's vocabulary the lesson title contains. */
function tokenOverlap(lessonText: string, categoryTitle: string): TokenMatch {
  const categoryTokens = tokens(categoryTitle);
  if (categoryTokens.size === 0) return { coverage: 0, matched: [] };
  const lessonTokens = tokens(lessonText);
  const matched = [...categoryTokens].filter((token) => lessonTokens.has(token));
  return { coverage: matched.length / categoryTokens.size, matched };
}

export interface CategorySuggestion {
  categoryId: string;
  categoryTitle: string;
  /** Full path, e.g. «Python › GIL». */
  categoryPath: string;
  /** Published questions in the category (what --apply would link). */
  questionCount: number;
  confidence: MatchConfidence;
  /** Which title produced the match. */
  matchedOn: "урок" | "модуль";
  /** Why it matched — the words the reviewer can check at a glance. */
  because: string;
  alreadyLinked: number;
}

export interface LessonSuggestion {
  lessonId: string;
  lessonSlug: string;
  lessonTitle: string;
  moduleTitle: string;
  courseTitle: string;
  suggestions: CategorySuggestion[];
}

interface CategoryRow {
  id: string;
  title: string;
  parentId: string | null;
}

/** «Python › GIL (глобальная блокировка)» for a readable review table. */
function pathOf(category: CategoryRow, byId: Map<string, CategoryRow>): string {
  const parts = [category.title];
  let cursor = category.parentId;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const parent = byId.get(cursor);
    if (!parent) break;
    parts.unshift(parent.title);
    cursor = parent.parentId;
  }
  return parts.join(" › ");
}

/** Strength of a whole-NAME match (the importer's rule). */
function nameConfidence(target: string, categoryTitle: string): MatchConfidence {
  const t = normalizeName(target);
  const c = normalizeName(categoryTitle);
  if (t === c) return "высокая";
  const strip = (s: string) => normalizeName(s.replace(/\([^)]*\)/g, " "));
  if (strip(target) === strip(categoryTitle)) return "средняя";
  return "низкая";
}

/**
 * Proposes categories for every published lesson. READ ONLY.
 *
 * A lesson gets at most two suggestions: one from its own title and one from its
 * module's. The module match is the weaker signal (a whole module maps to a
 * broad category), so it is only offered when the lesson title matched nothing.
 */
export async function suggestLessonCategories(db: Db): Promise<LessonSuggestion[]> {
  const categories = await db.questionCategory.findMany({
    select: { id: true, title: true, parentId: true },
  });
  const byId = new Map(categories.map((c) => [c.id, c]));

  const counts = await db.question.groupBy({
    by: ["categoryId"],
    where: { status: "published" },
    _count: { _all: true },
  });
  const countByCategory = new Map(counts.map((c) => [c.categoryId, c._count._all]));

  const lessons = await db.lesson.findMany({
    where: {
      status: "published",
      module: { status: "published", course: { status: "published" } },
    },
    select: {
      id: true,
      slug: true,
      title: true,
      module: { select: { title: true, course: { select: { title: true, order: true } } } },
      questionLinks: { select: { question: { select: { categoryId: true } } } },
    },
    orderBy: [{ module: { course: { order: "asc" } } }, { order: "asc" }],
  });

  const out: LessonSuggestion[] = [];
  for (const lesson of lessons) {
    const linkedByCategory = new Map<string, number>();
    for (const link of lesson.questionLinks) {
      const id = link.question.categoryId;
      linkedByCategory.set(id, (linkedByCategory.get(id) ?? 0) + 1);
    }

    const suggestions: CategorySuggestion[] = [];
    const seen = new Set<string>();

    const push = (
      category: CategoryRow,
      confidence: MatchConfidence,
      matchedOn: "урок" | "модуль",
      because: string,
    ) => {
      if (seen.has(category.id)) return;
      seen.add(category.id);
      suggestions.push({
        categoryId: category.id,
        categoryTitle: category.title,
        categoryPath: pathOf(category, byId),
        questionCount: countByCategory.get(category.id) ?? 0,
        confidence,
        matchedOn,
        because,
        alreadyLinked: linkedByCategory.get(category.id) ?? 0,
      });
    };

    // 1. Whole-name match — the importer's own rule, unchanged.
    for (const [target, on] of [
      [lesson.title, "урок"],
      [lesson.module.title, "модуль"],
    ] as const) {
      const hit = matchCategoryName(target, categories);
      if (hit) push(hit, nameConfidence(target, hit.title), on, "совпало название");
    }

    // 2. Token coverage — how much of the category's vocabulary the lesson title
    //    contains. Ranked, best first; at most three proposals per lesson so the
    //    review table stays readable.
    const scored = categories
      .map((category) => ({ category, ...tokenOverlap(lesson.title, category.title) }))
      .filter((row) => row.coverage >= 0.5 && !seen.has(row.category.id))
      .sort((a, b) => b.coverage - a.coverage || b.matched.length - a.matched.length);

    for (const row of scored.slice(0, 3)) {
      const confidence: MatchConfidence =
        row.coverage === 1 && row.matched.length >= 2
          ? "высокая"
          : row.coverage === 1
            ? "средняя"
            : "низкая";
      push(row.category, confidence, "урок", `слова: ${row.matched.join(", ")}`);
    }

    out.push({
      lessonId: lesson.id,
      lessonSlug: lesson.slug,
      lessonTitle: lesson.title,
      moduleTitle: lesson.module.title,
      courseTitle: lesson.module.course.title,
      suggestions,
    });
  }
  return out;
}

export interface ApplyPlanRow {
  lessonId: string;
  lessonTitle: string;
  categoryTitle: string;
  toCreate: number;
  existing: number;
}

/**
 * Links every published question of `categoryId` to `lessonId` with the role
 * «просто привязан» (is_key=false, in_quiz=false).
 *
 * Idempotent and NON-DESTRUCTIVE: an existing link is left exactly as it is,
 * including its role — a question already marked «ключевой» must not be demoted
 * by a bulk pass. Key marking stays editorial (the checkboxes in the lesson
 * editor), never automatic.
 */
export async function linkCategoryToLesson(
  db: Db,
  input: { lessonId: string; categoryId: string; commit: boolean },
): Promise<{ created: number; existing: number }> {
  const questions = await db.question.findMany({
    where: { categoryId: input.categoryId, status: "published" },
    select: { id: true },
  });
  const already = await db.questionLesson.findMany({
    where: { lessonId: input.lessonId, questionId: { in: questions.map((q) => q.id) } },
    select: { questionId: true },
  });
  const have = new Set(already.map((a) => a.questionId));
  const missing = questions.filter((q) => !have.has(q.id));

  if (input.commit && missing.length > 0) {
    await db.questionLesson.createMany({
      data: missing.map((q) => ({
        questionId: q.id,
        lessonId: input.lessonId,
        isKey: false,
        inQuiz: false,
      })),
      skipDuplicates: true,
    });
  }
  return { created: missing.length, existing: have.size };
}
