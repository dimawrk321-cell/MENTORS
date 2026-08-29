import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getContentTree, listCategoryOptions } from "@/lib/services/content-admin";
import { getModulePoolCounts } from "@/lib/services/tests";
import { findStepDuplicates } from "@/lib/services/lesson-step-duplicates";
import { ContentStudioTabs } from "@/components/features/content-studio-tabs";
import { ContentTree, type TreeCourse } from "./content-tree";

export const metadata: Metadata = {
  title: "Контент",
};

/** Content studio tree (spec 8.5): drag order, statuses, CRUD dialogs. */
export default async function ContentPage() {
  await requirePermission("content.manage");
  const [courses, categories] = await Promise.all([
    getContentTree(prisma),
    listCategoryOptions(prisma),
  ]);

  // Заход C.1: фактический размер пула теста — то, чего в админке не было
  // нигде, поэтому ментор не мог увидеть, что тест пустой. Считается пачкой
  // одним запросом на всё дерево, тем же условием, что пул на ученической
  // стороне (getModulePoolCounts).
  const poolCounts = await getModulePoolCounts(
    prisma,
    courses.flatMap((course) => course.modules.map((module) => module.id)),
  );

  // Заход C.10: шаг — независимая копия урока, и исходный урок остаётся в
  // программе. Автоматически его не прячем (это решение ментора), но дубль
  // называем прямо в дереве — там, где урок можно снять с публикации.
  const duplicates = await findStepDuplicates(
    prisma,
    courses.map((course) => course.id),
  );
  const duplicateByLesson = new Map<
    string,
    { hostTitle: string; reason: "content" | "title"; visibleTwice: boolean }
  >();
  for (const item of duplicates) {
    const known = duplicateByLesson.get(item.lessonId);
    // Совпадение по содержимому весомее совпадения по названию: первое значит,
    // что ученик читает одно и то же, второе — что у копии осталось чужое имя.
    if (known && (known.reason === "content" || item.reason === "title")) {
      duplicateByLesson.set(item.lessonId, {
        ...known,
        visibleTwice: known.visibleTwice || item.visibleTwice,
      });
      continue;
    }
    duplicateByLesson.set(item.lessonId, {
      hostTitle: item.stepLessonTitle,
      reason: item.reason,
      visibleTwice: (known?.visibleTwice ?? false) || item.visibleTwice,
    });
  }

  const tree: TreeCourse[] = courses.map((course) => ({
    id: course.id,
    title: course.title,
    slug: course.slug,
    description: course.description,
    gating: course.gating,
    status: course.status,
    questionCategoryIds: course.questionCategories.map((link) => link.categoryId),
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      status: module.status,
      poolCount: poolCounts.get(module.id) ?? 0,
      test: module.test
        ? {
            poolSize: module.test.poolSize,
            threshold: module.test.threshold,
            cooldownMinutes: module.test.cooldownMinutes,
            enabled: module.test.enabled,
            testoutEnabled: module.test.testoutEnabled,
            testoutThreshold: module.test.testoutThreshold,
          }
        : null,
      lessons: module.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        status: lesson.status,
        isOptional: lesson.isOptional,
        readingMinutes: lesson.readingMinutes,
        duplicate: duplicateByLesson.get(lesson.id) ?? null,
        steps: lesson.steps.map((step) => ({
          id: step.id,
          title: step.title,
          status: step.status,
          readingMinutes: step.readingMinutes,
          order: step.order,
        })),
      })),
    })),
  }));

  return (
    <div className="flex flex-col gap-4">
      <ContentStudioTabs />
      <ContentTree courses={tree} categories={categories} />
    </div>
  );
}
