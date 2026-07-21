import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getLessonForEditor } from "@/lib/services/content-admin";
import { listLessonQuestionLinks } from "@/lib/services/questions";
import { stripMarkdown } from "@/lib/utils/text";
import { LessonEditor } from "./lesson-editor";
import { LessonQuestions } from "./lesson-questions";

export const metadata: Metadata = {
  title: "Редактор урока",
};

interface EditorPageProps {
  params: Promise<{ id: string }>;
}

/** Two-pane lesson editor (spec 8.5): markdown ↔ live preview + metadata. */
export default async function LessonEditorPage({ params }: EditorPageProps) {
  await requirePermission("content.manage");
  const { id } = await params;
  const lesson = await getLessonForEditor(prisma, id);
  if (!lesson) notFound();
  const questionLinks = await listLessonQuestionLinks(prisma, lesson.id);

  return (
    <div className="flex flex-col gap-4">
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
      <LessonQuestions
        lessonId={lesson.id}
        links={questionLinks.map((link) => ({
          questionId: link.questionId,
          teaser: stripMarkdown(link.question.textMd, 120) || "— без текста —",
          category: link.question.category.title,
          status: link.question.status,
          isKey: link.isKey,
          inQuiz: link.inQuiz,
        }))}
      />
    </div>
  );
}
