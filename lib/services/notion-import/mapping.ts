import type { GuideSectionKey, PlanDifficulty } from "./types";

// Static mapping of the export's top level to the platform (spec 7.14 п.2/п.3).

/**
 * A top-level guide group. Most map 1:1 to a guide section; `resume_legend` is
 * one export section («Гайды по резюме и легенде») that yields two sections
 * (resume + legend) from its nested «Резюме»/«Легенда» nodes (spec 7.14 part 2).
 */
export type GuideGroup = GuideSectionKey | "resume_legend";

export type SectionRoute =
  | { kind: "courses" }
  | { kind: "questions" }
  | { kind: "guides"; group: GuideGroup }
  | { kind: "skip"; reason: string };

/** Routes a top-level `- **Section**` node by its title (spec 7.14 п.2 / part 2). */
export function routeTopLevelSection(title: string): SectionRoute {
  const t = title.trim();
  if (/^Спринты/i.test(t)) return { kind: "courses" };
  if (/^Вопросы с собеседований/i.test(t)) return { kind: "questions" };

  // Guides — importer part 2, stage 7 (spec changelog 7.14/17).
  if (/резюме|легенд/i.test(t)) return { kind: "guides", group: "resume_legend" };
  if (/которые нужно задать/i.test(t)) return { kind: "guides", group: "ask_interviewer" };
  if (/успешному прохождению/i.test(t)) return { kind: "guides", group: "stages" };
  if (/поиска работы/i.test(t)) return { kind: "guides", group: "job_search" };
  if (/^Собеседования/i.test(t))
    return { kind: "skip", reason: "ссылка на Я.Диск — библиотека наполняется вручную" };

  return { kind: "skip", reason: "неизвестный верхнеуровневый раздел" };
}

export interface CourseSpec {
  /** Match the export track title. */
  match: RegExp;
  slug: string;
  title: string;
  gating: "strict" | "recommended" | "free";
  order: number;
  /** Soft-skills lessons named «mock» get a :::mock CTA (spec 7.14 п.4). */
  mockLessons?: boolean;
  /**
   * NLP is one export track but two courses (spec 7.14 п.3): each `##` module
   * heading («Простая мапа» / «ШАД») becomes its own course. `splitByModule`
   * maps a heading title to a course slug/title.
   */
  splitByModule?: Array<{ headingMatch: RegExp; slug: string; title: string; order: number }>;
}

/** Tracks under «Спринты» that are NOT courses but guide groups (spec 7.14 part 2). */
export const GUIDE_TRACKS: Array<{ match: RegExp; group: GuideGroup }> = [
  { match: /Основные инструменты/i, group: "tools" },
];

/** Tracks under «Спринты» skipped entirely (none at part 2 — kept for anomalies). */
export const SKIPPED_TRACKS: Array<{ match: RegExp; reason: string }> = [];

/**
 * Track → course(s) (spec 7.14 п.3). Technical courses are strict; Soft Skills
 * and Classic ML are free (spec 7.3 gating defaults).
 */
export const COURSE_SPECS: CourseSpec[] = [
  {
    match: /^Python \+ PyTorch/i,
    slug: "python-pytorch",
    title: "Python + PyTorch",
    gating: "strict",
    order: 0,
  },
  {
    match: /^Алгоритм/i,
    slug: "algorithms-livecoding",
    title: "Алгоритмы и лайфкодинг",
    gating: "strict",
    order: 1,
  },
  {
    match: /^NLP$/i,
    slug: "nlp",
    title: "NLP",
    gating: "strict",
    order: 2,
    splitByModule: [
      { headingMatch: /Простая мапа/i, slug: "nlp-basic", title: "NLP: базовый курс", order: 2 },
      { headingMatch: /ШАД/i, slug: "nlp-advanced", title: "NLP: продвинутый", order: 3 },
    ],
  },
  {
    match: /^ML System Design/i,
    slug: "ml-system-design",
    title: "ML System Design",
    gating: "strict",
    order: 4,
  },
  {
    match: /^Soft skills/i,
    slug: "soft-skills",
    title: "Soft Skills",
    gating: "free",
    order: 5,
    mockLessons: true,
  },
  {
    match: /^Classic ML engineer/i,
    slug: "classic-ml-course",
    title: "Classic ML",
    gating: "free",
    order: 6,
  },
];

/** Heuristic difficulty from a lesson's course order/title (spec 6 enum). */
export function inferDifficulty(courseSlug: string, order: number): PlanDifficulty {
  if (courseSlug === "nlp-advanced") return "advanced";
  if (courseSlug === "classic-ml-course") return "base";
  return order === 0 ? "intro" : "base";
}
