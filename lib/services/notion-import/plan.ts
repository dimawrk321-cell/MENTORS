import { sha256Hex } from "@/lib/utils/crypto";
import { normalizeShortText } from "@/lib/utils/answers";
import { slugify } from "@/lib/utils/slug";
import { stripMarkdown } from "@/lib/utils/text";
import { parseNotionExport, nodeBody, dedent, type ParsedDoc, type ParsedNode } from "./parser";
import {
  convertLessonBody,
  convertQuestionAnswer,
  extractOptional,
  cleanNodeTitle,
} from "./content";
import { createImageResolver } from "./images";
import {
  SEED_ROOT_CATEGORIES,
  TRANSPARENT_STAGE_TITLES,
  matchSeedRoot,
  matchCategoryName,
} from "./categories";
import {
  routeTopLevelSection,
  COURSE_SPECS,
  SKIPPED_TRACKS,
  inferDifficulty,
  type CourseSpec,
} from "./mapping";
import type {
  ImportPlan,
  ImportAnomalies,
  PlannedCategory,
  PlannedCourse,
  PlannedLesson,
  PlannedModule,
  PlannedQuestion,
} from "./types";

// Tree → import plan (spec 7.14). Pure and DB-free: given the export markdown
// and the set of available image files, it produces the full intermediate
// representation plus every anomaly the report needs. The committer then writes
// this plan idempotently.

/** Course→default root category for «Проверка себя» questions (spec 7.14 п.4). */
const COURSE_DEFAULT_CATEGORY: Record<string, string> = {
  "python-pytorch": "Python",
  "algorithms-livecoding": "Python",
  "nlp-basic": "NLP",
  "nlp-advanced": "NLP",
  "ml-system-design": "ML System Design",
  "classic-ml-course": "Classic ML",
};

function emptyAnomalies(): ImportAnomalies {
  return {
    questionsAtSubcategoryLevel: [],
    unrecognizedCategoryLinks: [],
    needsLatexQuestions: [],
    todoImages: [],
    skippedSections: [],
    createdNonSeedRootCategories: [],
  };
}

/** Normalized-text hash for skip-if-exists (spec 7.14 «хеш нормализованного текста»). */
export function questionHash(text: string): string {
  return sha256Hex(normalizeShortText(text));
}

class PlanBuilder {
  readonly plan: ImportPlan;
  private readonly resolver: ReturnType<typeof createImageResolver>;
  /** effectiveCategory|hash → true, to dedupe questions within the plan. */
  private readonly seenQuestions = new Set<string>();
  private readonly categoryByKey = new Map<string, PlannedCategory>();
  private nextColorIndex = SEED_ROOT_CATEGORIES.length;

  constructor(
    private readonly doc: ParsedDoc,
    availableImages: Set<string>,
  ) {
    this.resolver = createImageResolver(availableImages);
    this.plan = {
      courses: [],
      categories: [],
      questions: [],
      images: [],
      anomalies: emptyAnomalies(),
    };
  }

  build(): ImportPlan {
    for (const section of this.doc.roots) {
      if (section.kind !== "bullet") continue;
      const route = routeTopLevelSection(section.title);
      if (route.kind === "questions") this.processQuestions(section);
    }
    // Courses after questions so category links / key-question categories resolve.
    for (const section of this.doc.roots) {
      if (section.kind !== "bullet") continue;
      const route = routeTopLevelSection(section.title);
      if (route.kind === "courses") this.processCourses(section);
      else if (route.kind === "skip") {
        this.plan.anomalies.skippedSections.push({
          title: section.title,
          reason: route.reason,
          line: section.line + 1,
        });
      }
    }
    this.plan.images = this.resolver.refs();
    return this.plan;
  }

  // --- Question bank (spec 7.14 п.5) ---

  private registerCategory(cat: PlannedCategory): PlannedCategory {
    const key = `${cat.parentTitle ?? ""} ${cat.title}`;
    const existing = this.categoryByKey.get(key);
    if (existing) return existing;
    this.categoryByKey.set(key, cat);
    this.plan.categories.push(cat);
    return cat;
  }

  private processQuestions(section: ParsedNode): void {
    for (const stage of section.children) {
      if (stage.kind !== "bullet") continue;
      if (this.isTransparentStage(stage)) {
        for (const cat of stage.children) {
          if (cat.kind === "bullet") this.processRootCategory(cat);
        }
      } else {
        this.processRootCategory(stage);
      }
    }
  }

  /** A stage node whose children are the real root categories (spec 7.14). */
  private isTransparentStage(node: ParsedNode): boolean {
    if (TRANSPARENT_STAGE_TITLES.some((t) => t === node.title)) return true;
    const bulletChildren = node.children.filter((c) => c.kind === "bullet");
    if (bulletChildren.length < 2) return false;
    const matched = bulletChildren.filter((c) => matchSeedRoot(c.title)).length;
    return matched / bulletChildren.length >= 0.5;
  }

  private processRootCategory(node: ParsedNode): void {
    const seed = matchSeedRoot(node.title);
    let root: PlannedCategory;
    if (seed) {
      const colorIndex = SEED_ROOT_CATEGORIES.findIndex((c) => c.title === seed.title);
      root = this.registerCategory({
        title: seed.title,
        slug: seed.slug,
        parentTitle: null,
        isSeed: true,
        colorIndex,
        sourceLine: node.line + 1,
      });
    } else {
      const title = cleanNodeTitle(node.title);
      const colorIndex = this.nextColorIndex;
      this.nextColorIndex += 1;
      root = this.registerCategory({
        title,
        slug: slugify(title),
        parentTitle: null,
        isSeed: false,
        colorIndex,
        sourceLine: node.line + 1,
      });
      if (root.colorIndex === colorIndex) {
        this.plan.anomalies.createdNonSeedRootCategories.push({ title, line: node.line + 1 });
      }
    }

    for (const child of node.children) {
      if (child.kind !== "bullet") continue;
      if (this.looksLikeQuestion(child)) {
        // Question sitting at subcategory level → root category (spec 7.14 п.5).
        this.addQuestion(child, root, null, true);
      } else {
        this.processSubcategory(child, root);
      }
    }
  }

  private processSubcategory(node: ParsedNode, root: PlannedCategory): void {
    const title = cleanNodeTitle(node.title);
    const sub = this.registerCategory({
      title,
      slug: slugify(`${root.slug}-${title}`),
      parentTitle: root.title,
      isSeed: false,
      colorIndex: root.colorIndex,
      sourceLine: node.line + 1,
    });
    let hadQuestion = false;
    for (const child of node.children) {
      if (child.kind !== "bullet") continue;
      this.addQuestion(child, root, sub, false);
      hadQuestion = true;
    }
    // A subcategory whose body is the answer (no question children) is itself a
    // question mis-nested one level up — but only when it had no bold children.
    if (!hadQuestion && nodeBody(this.doc, node).trim() !== "") {
      this.addQuestion(node, root, null, true);
    }
  }

  /** Heuristic (spec 7.14 п.5): «?» or non-empty body without bold children. */
  private looksLikeQuestion(node: ParsedNode): boolean {
    if (/\?/.test(node.title)) return true;
    const bulletChildren = node.children.filter((c) => c.kind === "bullet");
    if (bulletChildren.length > 0) return false;
    return nodeBody(this.doc, node).trim() !== "";
  }

  private addQuestion(
    node: ParsedNode,
    root: PlannedCategory,
    sub: PlannedCategory | null,
    atSubcategoryLevel: boolean,
  ): void {
    const textMd = cleanNodeTitle(node.title);
    if (!textMd) return;
    const effectiveCategory = sub?.title ?? root.title;
    const hash = questionHash(textMd);
    // Dedup within the exact (root, sub) pair — two «Метрики» subcats exist.
    const dedupeKey = `${root.title} ${sub?.title ?? ""} ${hash}`;
    if (this.seenQuestions.has(dedupeKey)) return;
    this.seenQuestions.add(dedupeKey);

    const answer = convertQuestionAnswer(nodeBody(this.doc, node), this.resolver);
    for (const todo of answer.todoImages) {
      this.plan.anomalies.todoImages.push({
        path: todo.path,
        where: `вопрос «${textMd.slice(0, 60)}»`,
        line: node.line + 1,
      });
    }

    const question: PlannedQuestion = {
      rootCategoryTitle: root.title,
      subCategoryTitle: sub?.title ?? null,
      textMd,
      answerMd: answer.answerMd,
      needsLatex: answer.needsLatex,
      hash,
      sourceLine: node.line + 1,
    };
    this.plan.questions.push(question);

    if (answer.needsLatex) {
      this.plan.anomalies.needsLatexQuestions.push({
        text: textMd,
        category: effectiveCategory,
        line: node.line + 1,
      });
    }
    if (atSubcategoryLevel) {
      this.plan.anomalies.questionsAtSubcategoryLevel.push({
        text: textMd,
        category: root.title,
        line: node.line + 1,
      });
    }
  }

  // --- Courses (spec 7.14 п.3/п.4) ---

  private processCourses(section: ParsedNode): void {
    for (const track of section.children) {
      if (track.kind !== "bullet") continue;

      const skipped = SKIPPED_TRACKS.find((s) => s.match.test(track.title));
      if (skipped) {
        this.plan.anomalies.skippedSections.push({
          title: track.title,
          reason: skipped.reason,
          line: track.line + 1,
        });
        continue;
      }

      const spec = COURSE_SPECS.find((c) => c.match.test(track.title));
      if (!spec) {
        this.plan.anomalies.skippedSections.push({
          title: track.title,
          reason: "неизвестный трек в «Спринтах»",
          line: track.line + 1,
        });
        continue;
      }

      if (spec.splitByModule) this.processSplitTrack(track, spec);
      else this.processSingleTrack(track, spec);
    }
  }

  private lessonNodes(track: ParsedNode): ParsedNode[] {
    return track.children.filter((c) => c.kind === "bullet");
  }

  private processSingleTrack(track: ParsedNode, spec: CourseSpec): void {
    const lessons = this.lessonNodes(track);
    const course = this.makeCourse(spec, spec.slug, spec.title, spec.order, track, track.line);
    const mod: PlannedModule = { title: "Основной", order: 0, lessons: [] };
    lessons.forEach((node, i) => mod.lessons.push(this.makeLesson(node, spec, i, mod)));
    course.modules.push(mod);
    this.plan.courses.push(course);
  }

  /** NLP: one track → two courses split by `##` module headings (spec 7.14 п.3). */
  private processSplitTrack(track: ParsedNode, spec: CourseSpec): void {
    const headings = track.children.filter((c) => c.kind === "module-heading");
    const lessons = this.lessonNodes(track);

    for (const split of spec.splitByModule!) {
      const heading = headings.find((h) => split.headingMatch.test(h.title));
      if (!heading) continue;
      // Lessons between this heading and the next heading (doc order).
      const laterHeadings = headings
        .filter((h) => h.line > heading.line)
        .map((h) => h.line)
        .sort((a, b) => a - b);
      const upper = laterHeadings[0] ?? Infinity;
      const own = lessons.filter((l) => l.line > heading.line && l.line < upper);

      const course = this.makeCourse(
        spec,
        split.slug,
        split.title,
        split.order,
        heading,
        heading.line,
      );
      const mod: PlannedModule = { title: "Основной", order: 0, lessons: [] };
      own.forEach((node, i) =>
        mod.lessons.push(this.makeLesson(node, { ...spec, slug: split.slug }, i, mod)),
      );
      course.modules.push(mod);
      this.plan.courses.push(course);
    }
  }

  private makeCourse(
    spec: CourseSpec,
    slug: string,
    title: string,
    order: number,
    introNode: ParsedNode,
    introLine: number,
  ): PlannedCourse {
    void introLine;
    // Description teaser from the intro text before the first lesson/heading.
    const introEnd =
      introNode.children.find((c) => c.kind !== "module-heading")?.line ?? introNode.endLine;
    const intro = dedent(this.doc.lines.slice(introNode.line + 1, introEnd));
    return {
      slug,
      title,
      description: stripMarkdown(intro, 280),
      order,
      gating: spec.gating,
      modules: [],
    };
  }

  private makeLesson(
    node: ParsedNode,
    spec: CourseSpec,
    index: number,
    mod: PlannedModule,
  ): PlannedLesson {
    const cleaned = cleanNodeTitle(node.title);
    const { title, isOptional } = extractOptional(cleaned);
    const converted = convertLessonBody(nodeBody(this.doc, node), this.resolver);

    for (const todo of converted.todoImages) {
      this.plan.anomalies.todoImages.push({
        path: todo.path,
        where: `урок «${title.slice(0, 60)}»`,
        line: node.line + 1,
      });
    }

    let contentMd = converted.contentMd;
    if (spec.mockLessons && /mock/i.test(title)) {
      contentMd = `:::mock{type="legend"}\n:::\n\n${contentMd}`.trim();
    }

    const slug = this.uniqueLessonSlug(slugify(title) || `lesson-${index + 1}`, mod);
    const defaultRoot = this.keyQuestionRoot(spec.slug, converted.categoryLinkNames);
    const categoryLinkSlugs = this.resolveCategoryLinks(
      converted.categoryLinkNames,
      title,
      node.line + 1,
    );

    return {
      slug,
      title,
      order: index,
      difficulty: inferDifficulty(spec.slug, index),
      isOptional,
      contentMd,
      videoUrl: converted.videoUrl,
      keyQuestions: converted.keyQuestions.map((textMd) => ({
        textMd,
        categoryTitle: defaultRoot,
      })),
      categoryLinkSlugs,
      sourceLine: node.line + 1,
    };
  }

  private uniqueLessonSlug(base: string, mod: PlannedModule): string {
    const taken = new Set(mod.lessons.map((l) => l.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /** Root category for a lesson's «Проверка себя» questions (FK is required). */
  private keyQuestionRoot(courseSlug: string, linkNames: string[]): string {
    for (const name of linkNames) {
      const cat = matchCategoryName(name, this.plan.categories);
      if (cat) return cat.parentTitle ?? cat.title;
    }
    return COURSE_DEFAULT_CATEGORY[courseSlug] ?? SEED_ROOT_CATEGORIES[0]!.title;
  }

  /** Resolves «Категории…» names to category slugs (unique) — spec 7.14 п.4. */
  private resolveCategoryLinks(names: string[], lessonTitle: string, line: number): string[] {
    const resolved: string[] = [];
    for (const name of names) {
      const cat = matchCategoryName(name, this.plan.categories);
      if (cat) resolved.push(cat.slug);
      else this.plan.anomalies.unrecognizedCategoryLinks.push({ name, lessonTitle, line });
    }
    return [...new Set(resolved)];
  }
}

export function buildImportPlan(markdown: string, availableImages: Set<string>): ImportPlan {
  const doc = parseNotionExport(markdown);
  return new PlanBuilder(doc, availableImages).build();
}
