import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getContentTree, listCategoryOptions } from "@/lib/services/content-admin";
import { getModulePoolCounts } from "@/lib/services/tests";
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
