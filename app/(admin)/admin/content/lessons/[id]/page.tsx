import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdminZone } from "@/lib/auth/guards";
import { getLessonForEditor } from "@/lib/services/content-admin";
import { LessonEditor } from "./lesson-editor";

export const metadata: Metadata = {
  title: "Редактор урока",
};

interface EditorPageProps {
  params: Promise<{ id: string }>;
}

/** Two-pane lesson editor (spec 8.5): markdown ↔ live preview + metadata. */
export default async function LessonEditorPage({ params }: EditorPageProps) {
  await requireAdminZone();
  const { id } = await params;
  const lesson = await getLessonForEditor(prisma, id);
  if (!lesson) notFound();

  return (
    <LessonEditor
      lesson={{
        id: lesson.id,
        title: lesson.title,
        slug: lesson.slug,
        contentMd: lesson.contentMd,
        videoUrl: lesson.videoUrl ?? "",
        difficulty: lesson.difficulty,
        isOptional: lesson.isOptional,
        status: lesson.status,
        readingMinutes: lesson.readingMinutes,
      }}
      courseTitle={lesson.module.course.title}
      moduleTitle={lesson.module.title}
    />
  );
}
