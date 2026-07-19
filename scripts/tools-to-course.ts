import { prisma } from "@/lib/db";
import { computeReadingMinutes } from "@/lib/utils/markdown";

// One-shot, idempotent conversion (spec 12.1/C4): the справочник section `tools`
// («Инструменты индустрии», 14 guides) becomes a course with one module. Guides
// move to lessons (status preserved), then the tools guides are deleted; their
// bookmarks are lost (counted in the report). A second run is a no-op (no tools
// guides left → "нечего переносить"). Create + delete run in one transaction so a
// half-done state can never leave duplicated lessons.
//
// Run:  pnpm exec tsx scripts/tools-to-course.ts [--dry-run]

const COURSE_SLUG = "tools-course";
const COURSE_TITLE = "Инструменты индустрии";
const MODULE_TITLE = "Инструменты индустрии";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const guides = await prisma.guide.findMany({
    where: { section: "tools" },
    orderBy: [{ order: "asc" }, { title: "asc" }],
  });

  if (guides.length === 0) {
    console.log("Нечего переносить: гайдов секции tools нет (уже перенесены или отсутствуют).");
    return;
  }

  const guideIds = guides.map((g) => g.id);
  const lostBookmarks = await prisma.bookmark.count({ where: { guideId: { in: guideIds } } });
  const publishedCount = guides.filter((g) => g.status === "published").length;

  console.log(
    `${dryRun ? "[dry-run] " : ""}Секция tools: ${guides.length} гайдов ` +
      `(${publishedCount} опубликованных), закладок к удалению: ${lostBookmarks}.`,
  );

  if (dryRun) {
    console.log(
      `[dry-run] Будет создан курс «${COURSE_TITLE}» (slug ${COURSE_SLUG}, gating free), ` +
        `1 модуль, ${guides.length} уроков; ${guides.length} гайдов удалено; ` +
        `${lostBookmarks} закладок утрачено.`,
    );
    return;
  }

  const now = new Date();
  const lastCourse = await prisma.course.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const courseOrder = (lastCourse?.order ?? -1) + 1;

  const result = await prisma.$transaction(async (tx) => {
    // Find-or-create the course (published so the migrated lessons are visible).
    let course = await tx.course.findUnique({ where: { slug: COURSE_SLUG } });
    if (!course) {
      course = await tx.course.create({
        data: {
          slug: COURSE_SLUG,
          title: COURSE_TITLE,
          description: "Практические инструменты индустрии ML / DS / NLP / AI Engineering.",
          order: courseOrder,
          gating: "free",
          status: "published",
        },
      });
    }

    // Find-or-create the single module.
    let mod = await tx.module.findFirst({ where: { courseId: course.id } });
    if (!mod) {
      mod = await tx.module.create({
        data: { courseId: course.id, title: MODULE_TITLE, order: 0, status: "published" },
      });
    }

    // Idempotency guard: never duplicate lessons into a module that already has them.
    const existingLessons = await tx.lesson.count({ where: { moduleId: mod.id } });
    if (existingLessons > 0) {
      throw new Error(
        `Модуль курса уже содержит ${existingLessons} уроков — перенос прерван во избежание дублей. ` +
          `Разберись с состоянием вручную (курс ${COURSE_SLUG}).`,
      );
    }

    let order = 0;
    for (const guide of guides) {
      await tx.lesson.create({
        data: {
          moduleId: mod.id,
          slug: guide.slug,
          title: guide.title,
          order: order++,
          status: guide.status,
          difficulty: "base",
          isOptional: false,
          contentMd: guide.contentMd,
          readingMinutes: computeReadingMinutes(guide.contentMd),
          publishedAt: guide.status === "published" ? now : null,
        },
      });
    }

    // Delete moved guides (cascade removes their bookmarks — schema onDelete).
    const deleted = await tx.guide.deleteMany({ where: { id: { in: guideIds } } });

    return {
      courseId: course.id,
      moduleId: mod.id,
      lessons: guides.length,
      deleted: deleted.count,
    };
  });

  console.log("Перенос завершён:");
  console.log(`  курс:     ${COURSE_TITLE} (${result.courseId})`);
  console.log(`  модуль:   ${result.moduleId}`);
  console.log(`  уроков:   ${result.lessons} создано`);
  console.log(`  гайдов:   ${result.deleted} удалено`);
  console.log(`  закладок: ${lostBookmarks} утрачено`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
