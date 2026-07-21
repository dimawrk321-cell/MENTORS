import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getContentTree } from "@/lib/services/content-admin";
import { ContentStudioTabs } from "@/components/features/content-studio-tabs";
import { ContentTree, type TreeCourse } from "./content-tree";

export const metadata: Metadata = {
  title: "Контент",
};

/** Content studio tree (spec 8.5): drag order, statuses, CRUD dialogs. */
export default async function ContentPage() {
  await requirePermission("content.manage");
  const courses = await getContentTree(prisma);

  const tree: TreeCourse[] = courses.map((course) => ({
    id: course.id,
    title: course.title,
    slug: course.slug,
    description: course.description,
    gating: course.gating,
    status: course.status,
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      status: module.status,
      test: module.test
        ? {
            poolSize: module.test.poolSize,
            threshold: module.test.threshold,
            cooldownMinutes: module.test.cooldownMinutes,
            enabled: module.test.enabled,
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
      <ContentTree courses={tree} />
    </div>
  );
}
