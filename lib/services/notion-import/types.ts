// One-off Notion importer, part 1 (spec 7.14): courses/modules/lessons + the
// question bank. Types shared across the parser, plan builder, committer and
// report. The plan is a pure, DB-free intermediate representation — the whole
// mapping is unit-tested on it before a single row is written.

export type PlanDifficulty = "intro" | "base" | "advanced";

/** «Проверка себя:» → open key question authored by a lesson (spec 7.14 п.4). */
export interface PlannedKeyQuestion {
  textMd: string;
  /** Resolved seed root-category title used for the question's category_id. */
  categoryTitle: string;
}

export interface PlannedLesson {
  slug: string;
  title: string;
  order: number;
  difficulty: PlanDifficulty;
  isOptional: boolean;
  contentMd: string;
  videoUrl: string | null;
  /** «Проверка себя:» questions (is_key=true). */
  keyQuestions: PlannedKeyQuestion[];
  /** Resolved category slugs from «Категории вопросов…» to link (spec 7.14 п.4). */
  categoryLinkSlugs: string[];
  sourceLine: number;
}

export interface PlannedModule {
  title: string;
  order: number;
  lessons: PlannedLesson[];
}

export interface PlannedCourse {
  slug: string;
  title: string;
  description: string;
  order: number;
  gating: "strict" | "recommended" | "free";
  modules: PlannedModule[];
}

/** Root or sub category destined for the question bank. */
export interface PlannedCategory {
  title: string;
  slug: string;
  /** Parent title for subcategories; null for roots. */
  parentTitle: string | null;
  /** true when matched to a seed root category (spec 7.4). */
  isSeed: boolean;
  /** Assigned only to roots (spec 5.1 colour palette order). */
  colorIndex: number | null;
  sourceLine: number;
}

export interface PlannedQuestion {
  /** Root category title (a subcategory question still names its root for FK). */
  rootCategoryTitle: string;
  /** Subcategory title if the question lives under one, else null. */
  subCategoryTitle: string | null;
  textMd: string;
  answerMd: string;
  needsLatex: boolean;
  /** Normalized-text hash for skip-if-exists idempotency within a category. */
  hash: string;
  sourceLine: number;
}

export interface ImageRef {
  /** Decoded original path relative to the export root. */
  originalDecodedPath: string;
  /** ASCII, git-safe basename under public/media/import/. */
  normalizedName: string;
}

export interface ImportAnomalies {
  /** Questions found at subcategory depth (spec 7.14 п.5). */
  questionsAtSubcategoryLevel: Array<{ text: string; category: string; line: number }>;
  /** «Категории…» names from lessons that matched no category. */
  unrecognizedCategoryLinks: Array<{ name: string; lessonTitle: string; line: number }>;
  /** Answers that were image-only → needs_latex (spec 7.14 п.5). */
  needsLatexQuestions: Array<{ text: string; category: string; line: number }>;
  /** Image references whose file was missing → TODO placeholder. */
  todoImages: Array<{ path: string; where: string; line: number }>;
  /** Top-level sections skipped with a note (spec 7.14 п.2). */
  skippedSections: Array<{ title: string; reason: string; line: number }>;
  /** Non-seed root categories created from the export (Скрининг, Top Grading…). */
  createdNonSeedRootCategories: Array<{ title: string; line: number }>;
}

export interface ImportPlan {
  courses: PlannedCourse[];
  categories: PlannedCategory[];
  questions: PlannedQuestion[];
  /** Distinct images referenced by imported content (for copy + rewrite). */
  images: ImageRef[];
  anomalies: ImportAnomalies;
}
