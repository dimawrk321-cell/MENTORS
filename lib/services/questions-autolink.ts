import type { Db } from "@/lib/db";
import { buildImportPlan } from "@/lib/services/notion-import/plan";

// Autolink questions to lessons from the importer's «Категории вопросов для
// заучивания в базе» hints (spec 7.14 п.4, walk 13.6 block 3).
//
// WHY THE EXPORT FILE IS REQUIRED: the hints are NOT stored anywhere queryable.
// notion-import/content.ts strips that line out of content_md during conversion
// and the resolved slugs live only in the in-memory ImportPlan. So this replays
// the plan from the SAME markdown export the importer consumed, reusing
// buildImportPlan verbatim — there is no second import logic (see the changelog
// entry «К разделам 8.5/7.4», corrected in 13.6).
//
// Role is «просто привязан» (is_key=false, in_quiz=false). Existing links are
// LEFT ALONE — never upserted — because an upsert would demote a link the team
// marked as key.

export interface AutolinkReport {
  /** Lessons the plan carries hints for. */
  lessonsWithHints: number;
  /** Of those, found in the DB by course+module+lesson slug. */
  lessonsMatched: number;
  lessonsMissing: string[];
  /** Hint slugs that matched no category row. */
  categoriesMissing: string[];
  /** Links that would be / were created. */
  created: number;
  /** Links already present (left untouched, including is_key ones). */
  skippedExisting: number;
  /** Per-lesson detail for the report. */
  perLesson: Array<{ lesson: string; categories: string[]; created: number; existing: number }>;
}

/** Category ids for a hint slug: the root plus its children (same as the catalog). */
async function categoryFamily(db: Db, slug: string): Promise<string[]> {
  const root = await db.questionCategory.findFirst({ where: { slug }, select: { id: true } });
  if (!root) return [];
  const children = await db.questionCategory.findMany({
    where: { parentId: root.id },
    select: { id: true },
  });
  return [root.id, ...children.map((c) => c.id)];
}

export async function autolinkQuestions(
  db: Db,
  input: { markdown: string; commit: boolean },
): Promise<AutolinkReport> {
  const plan = buildImportPlan(input.markdown, new Set());
  const report: AutolinkReport = {
    lessonsWithHints: 0,
    lessonsMatched: 0,
    lessonsMissing: [],
    categoriesMissing: [],
    created: 0,
    skippedExisting: 0,
    perLesson: [],
  };
  const missingCats = new Set<string>();

  for (const course of plan.courses) {
    for (const mod of course.modules) {
      for (const planned of mod.lessons) {
        if (planned.categoryLinkSlugs.length === 0) continue;
        report.lessonsWithHints += 1;

        // Lesson slugs are unique per module, so resolve through the chain.
        const lesson = await db.lesson.findFirst({
          where: {
            slug: planned.slug,
            module: { title: mod.title, course: { slug: course.slug } },
          },
          select: { id: true, title: true },
        });
        if (!lesson) {
          report.lessonsMissing.push(`${course.slug}/${mod.title}/${planned.slug}`);
          continue;
        }
        report.lessonsMatched += 1;

        const categoryIds: string[] = [];
        for (const slug of planned.categoryLinkSlugs) {
          const family = await categoryFamily(db, slug);
          if (family.length === 0) missingCats.add(slug);
          categoryIds.push(...family);
        }
        if (categoryIds.length === 0) continue;

        const questions = await db.question.findMany({
          where: { categoryId: { in: categoryIds } },
          select: { id: true },
        });
        const existing = await db.questionLesson.findMany({
          where: { lessonId: lesson.id, questionId: { in: questions.map((q) => q.id) } },
          select: { questionId: true },
        });
        const already = new Set(existing.map((e) => e.questionId));
        const toCreate = questions.filter((q) => !already.has(q.id));

        if (input.commit && toCreate.length > 0) {
          // createMany + skipDuplicates leans on @@unique([questionId, lessonId]),
          // so a concurrent run cannot double-link.
          await db.questionLesson.createMany({
            data: toCreate.map((q) => ({
              questionId: q.id,
              lessonId: lesson.id,
              isKey: false,
              inQuiz: false,
            })),
            skipDuplicates: true,
          });
        }

        report.created += toCreate.length;
        report.skippedExisting += already.size;
        report.perLesson.push({
          lesson: `${course.slug}/${planned.slug}`,
          categories: planned.categoryLinkSlugs,
          created: toCreate.length,
          existing: already.size,
        });
      }
    }
  }

  report.categoriesMissing = [...missingCats];
  return report;
}
