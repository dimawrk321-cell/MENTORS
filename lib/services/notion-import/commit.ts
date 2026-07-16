import type { Db } from "@/lib/db";
import { computeReadingMinutes } from "@/lib/utils/markdown";
import { questionHash } from "./plan";
import type { ImportPlan, PlannedCategory, PlannedGuide, PlannedLesson } from "./types";

// Idempotent committer (spec 7.14 «Правила безопасности импорта»). Everything is
// created as draft; nothing publishes. Skip-if-exists keys: course by slug,
// module by (course,title), lesson by (module,slug) — slug is the title's
// unique-ified form (the plan disambiguates «X» and «X (ДОПОЛНИТЕЛЬНО…)» to
// distinct slugs; keying on raw title would collapse them), question by
// normalized-text hash within its category. A second run creates nothing new.
// dryRun assigns synthetic ids to would-create rows so it reports accurate
// created/skipped counts (links included) without writing.

export interface Counts {
  created: number;
  skipped: number;
}

export interface CommitResult {
  dryRun: boolean;
  courses: Counts;
  modules: Counts;
  lessons: Counts;
  categories: Counts;
  questions: Counts;
  keyQuestions: Counts;
  /** is_key links from «Проверка себя». */
  keyLinks: Counts;
  /** «просто привязан» links from «Категории вопросов…». */
  categoryLinks: Counts;
  /** Guides (importer part 2). */
  guides: Counts;
}

function zero(): Counts {
  return { created: 0, skipped: 0 };
}

class Committer {
  private readonly result: CommitResult = {
    dryRun: false,
    courses: zero(),
    modules: zero(),
    lessons: zero(),
    categories: zero(),
    questions: zero(),
    keyQuestions: zero(),
    keyLinks: zero(),
    categoryLinks: zero(),
    guides: zero(),
  };
  /** «parentTitle|title» → category id — disambiguates same-named subcats. */
  private readonly categoryIdByComposite = new Map<string, string | null>();
  /** slug → category id (slug is globally unique) — for «Категории…» links. */
  private readonly categoryIdBySlug = new Map<string, string | null>();
  /** category id → (question hash → question id) — for dedupe + link reuse. */
  private readonly questionsByCategory = new Map<string, Map<string, string>>();
  /** (lessonId|questionId) seen this dry-run — to count link skips accurately. */
  private readonly seenLinks = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly plan: ImportPlan,
    private readonly dryRun: boolean,
  ) {}

  async run(): Promise<CommitResult> {
    this.result.dryRun = this.dryRun;
    for (const cat of this.plan.categories) await this.ensureCategory(cat);
    for (const question of this.plan.questions) {
      const parentTitle = question.subCategoryTitle ? question.rootCategoryTitle : null;
      const title = question.subCategoryTitle ?? question.rootCategoryTitle;
      const categoryId = await this.categoryId(parentTitle, title);
      await this.ensureQuestion(
        categoryId,
        question.textMd,
        question.answerMd,
        question.needsLatex,
        this.result.questions,
      );
    }
    for (const course of this.plan.courses) await this.ensureCourse(course);
    for (const guide of this.plan.guides) await this.ensureGuide(guide);
    return this.result;
  }

  // --- Guides (importer part 2) ---

  /** Skip-if-exists by slug (spec 7.14 part 2); created as draft. */
  private async ensureGuide(guide: PlannedGuide): Promise<void> {
    const existing = await this.db.guide.findUnique({ where: { slug: guide.slug } });
    if (existing) {
      this.result.guides.skipped += 1;
      return;
    }
    this.result.guides.created += 1;
    if (this.dryRun) return;
    await this.db.guide.create({
      data: {
        slug: guide.slug,
        section: guide.section,
        title: guide.title,
        order: guide.order,
        contentMd: guide.contentMd,
        status: "draft",
      },
    });
  }

  // --- Categories ---

  private composite(parentTitle: string | null, title: string): string {
    return `${parentTitle ?? ""}␟${title}`;
  }

  /** Synthetic id for a would-create row in dry-run (never collides with a cuid). */
  private dryId(kind: string, key: string): string {
    return `dry:${kind}:${key}`;
  }

  private async ensureCategory(cat: PlannedCategory): Promise<void> {
    const key = this.composite(cat.parentTitle, cat.title);
    if (this.categoryIdByComposite.has(key)) return;

    const parentId = cat.parentTitle ? await this.categoryId(null, cat.parentTitle) : null;
    const existing =
      (await this.db.questionCategory.findUnique({ where: { slug: cat.slug } })) ??
      (await this.db.questionCategory.findFirst({ where: { title: cat.title, parentId } }));

    if (existing) {
      this.result.categories.skipped += 1;
      this.rememberCategory(key, cat.slug, existing.id);
      return;
    }
    this.result.categories.created += 1;
    if (this.dryRun) {
      this.rememberCategory(key, cat.slug, this.dryId("cat", cat.slug));
      return;
    }
    const created = await this.db.questionCategory.create({
      data: {
        title: cat.title,
        slug: cat.slug,
        parentId,
        colorIndex: cat.colorIndex ?? 0,
        order: cat.colorIndex ?? 0,
      },
    });
    this.rememberCategory(key, cat.slug, created.id);
  }

  private rememberCategory(compositeKey: string, slug: string, id: string | null): void {
    this.categoryIdByComposite.set(compositeKey, id);
    this.categoryIdBySlug.set(slug, id);
  }

  /** Resolves a category by (parent title, title) — roots pass parentTitle=null. */
  private async categoryId(parentTitle: string | null, title: string): Promise<string | null> {
    const key = this.composite(parentTitle, title);
    if (this.categoryIdByComposite.has(key)) return this.categoryIdByComposite.get(key)!;
    const parentId = parentTitle ? await this.categoryId(null, parentTitle) : null;
    const found = await this.db.questionCategory.findFirst({ where: { title, parentId } });
    this.categoryIdByComposite.set(key, found?.id ?? null);
    return found?.id ?? null;
  }

  private async categoryIdForSlug(slug: string): Promise<string | null> {
    if (this.categoryIdBySlug.has(slug)) return this.categoryIdBySlug.get(slug)!;
    const found = await this.db.questionCategory.findUnique({ where: { slug } });
    this.categoryIdBySlug.set(slug, found?.id ?? null);
    return found?.id ?? null;
  }

  // --- Questions (bank + key) ---

  private async categoryQuestions(categoryId: string): Promise<Map<string, string>> {
    const cached = this.questionsByCategory.get(categoryId);
    if (cached) return cached;
    const rows = await this.db.question.findMany({
      where: { categoryId },
      select: { id: true, textMd: true },
    });
    const map = new Map<string, string>();
    for (const row of rows) map.set(questionHash(row.textMd), row.id);
    this.questionsByCategory.set(categoryId, map);
    return map;
  }

  /** Creates (or finds) a question in a category by normalized-text hash. */
  private async ensureQuestion(
    categoryId: string | null,
    textMd: string,
    answerMd: string,
    needsLatex: boolean,
    counts: Counts,
  ): Promise<string | null> {
    const hash = questionHash(textMd);
    if (categoryId === null) {
      // Category could not be resolved at all — count as would-create, no link.
      counts.created += 1;
      return null;
    }
    const known = await this.categoryQuestions(categoryId);
    const existing = known.get(hash);
    if (existing) {
      counts.skipped += 1;
      return existing;
    }
    counts.created += 1;
    if (this.dryRun) {
      // Synthetic id so links to this would-create question can be counted.
      const synthetic = this.dryId("q", `${categoryId}:${hash}`);
      known.set(hash, synthetic);
      return synthetic;
    }
    const created = await this.db.question.create({
      data: {
        type: "open",
        categoryId,
        textMd,
        answerMd: answerMd || null,
        needsLatex,
        status: "draft",
        source: "import",
      },
    });
    known.set(hash, created.id);
    return created.id;
  }

  // --- Courses / modules / lessons ---

  private async ensureCourse(course: ImportPlan["courses"][number]): Promise<void> {
    const existing = await this.db.course.findUnique({ where: { slug: course.slug } });
    let courseId = existing?.id ?? null;
    if (existing) {
      this.result.courses.skipped += 1;
    } else {
      this.result.courses.created += 1;
      if (this.dryRun) {
        courseId = this.dryId("course", course.slug);
      } else {
        const created = await this.db.course.create({
          data: {
            slug: course.slug,
            title: course.title,
            description: course.description,
            order: course.order,
            gating: course.gating,
            status: "draft",
          },
        });
        courseId = created.id;
      }
    }

    for (const mod of course.modules) {
      let moduleId: string | null = null;
      const existingModule = courseId
        ? await this.db.module.findFirst({ where: { courseId, title: mod.title } })
        : null;
      if (existingModule) {
        this.result.modules.skipped += 1;
        moduleId = existingModule.id;
      } else {
        this.result.modules.created += 1;
        if (this.dryRun) {
          moduleId = this.dryId("mod", `${courseId}:${mod.title}`);
        } else if (courseId) {
          const created = await this.db.module.create({
            data: { courseId, title: mod.title, order: mod.order, status: "draft" },
          });
          moduleId = created.id;
        }
      }
      for (const lesson of mod.lessons) await this.ensureLesson(moduleId, lesson);
    }
  }

  private async ensureLesson(moduleId: string | null, lesson: PlannedLesson): Promise<void> {
    // Idempotency by (module, slug): the plan gives «X» / «X (ДОПОЛНИТЕЛЬНО…)»
    // distinct slugs but identical cleaned titles — a title key would collapse them.
    const existing = moduleId
      ? await this.db.lesson.findUnique({
          where: { moduleId_slug: { moduleId, slug: lesson.slug } },
        })
      : null;
    let lessonId = existing?.id ?? null;
    if (existing) {
      this.result.lessons.skipped += 1;
    } else {
      this.result.lessons.created += 1;
      if (this.dryRun && moduleId) {
        lessonId = this.dryId("lesson", `${moduleId}:${lesson.slug}`);
      } else if (!this.dryRun && moduleId) {
        const created = await this.db.lesson.create({
          data: {
            moduleId,
            slug: lesson.slug,
            title: lesson.title,
            order: lesson.order,
            status: "draft",
            difficulty: lesson.difficulty,
            isOptional: lesson.isOptional,
            contentMd: lesson.contentMd,
            readingMinutes: computeReadingMinutes(lesson.contentMd),
            videoUrl: lesson.videoUrl,
          },
        });
        lessonId = created.id;
      }
    }

    // «Проверка себя» → open key questions (is_key link). Category is a root.
    for (const key of lesson.keyQuestions) {
      const categoryId = await this.categoryId(null, key.categoryTitle);
      const questionId = await this.ensureQuestion(
        categoryId,
        key.textMd,
        "",
        false,
        this.result.keyQuestions,
      );
      await this.ensureLink(lessonId, questionId, { isKey: true }, this.result.keyLinks);
    }

    // «Категории вопросов…» → link all matched-category questions (просто привязан).
    for (const slug of lesson.categoryLinkSlugs) {
      const categoryId = await this.categoryIdForSlug(slug);
      if (!categoryId) continue;
      const known = await this.categoryQuestions(categoryId);
      for (const questionId of known.values()) {
        await this.ensureLink(lessonId, questionId, { isKey: false }, this.result.categoryLinks);
      }
    }
  }

  private async ensureLink(
    lessonId: string | null,
    questionId: string | null,
    opts: { isKey: boolean },
    counts: Counts,
  ): Promise<void> {
    if (!lessonId || !questionId) {
      // A row that would not be created (unresolved) — count as would-create.
      counts.created += 1;
      return;
    }
    if (this.dryRun) {
      // Synthetic ids: dedupe pairs in-memory so an is_key link and a later
      // category link to the same (lesson, question) count as one create + skip.
      const key = `${lessonId}|${questionId}`;
      if (this.seenLinks.has(key)) counts.skipped += 1;
      else {
        this.seenLinks.add(key);
        counts.created += 1;
      }
      return;
    }
    const existing = await this.db.questionLesson.findUnique({
      where: { questionId_lessonId: { questionId, lessonId } },
    });
    if (existing) {
      counts.skipped += 1;
      return;
    }
    counts.created += 1;
    await this.db.questionLesson.create({
      data: { questionId, lessonId, isKey: opts.isKey, inQuiz: false },
    });
  }
}

export async function commitPlan(
  db: Db,
  plan: ImportPlan,
  opts: { dryRun: boolean },
): Promise<CommitResult> {
  return new Committer(db, plan, opts.dryRun).run();
}
