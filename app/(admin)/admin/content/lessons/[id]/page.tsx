import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getLessonForEditor } from "@/lib/services/content-admin";
import { listCategoriesTree, listLessonQuestionLinks } from "@/lib/services/questions";
import { hasReferenceAnswer } from "@/lib/services/question-access";
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
  const [questionLinks, categoryTree, moduleTest] = await Promise.all([
    listLessonQuestionLinks(prisma, lesson.id),
    listCategoriesTree(prisma),
    // Заход C.1: секция «Вопросы урока» показывает, какие привязки идут в
    // модульный тест, — а это имеет смысл только когда тест у модуля есть и
    // включён.
    prisma.moduleTest.findUnique({
      where: { moduleId: lesson.moduleId },
      select: { enabled: true },
    }),
  ]);
  // Root categories + children for the «+ Добавить вопрос» filter (13.6);
  // the service expands a root to its family, so either level works.
  const categories = categoryTree.flatMap((root) => [
    { id: root.id, label: root.title },
    ...root.children.map((child) => ({ id: child.id, label: `— ${child.title}` })),
  ]);

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
          pathPolicy: lesson.pathPolicy,
          textMinutes: lesson.textMinutes,
          videoMinutes: lesson.videoMinutes,
          practiceMinutes: lesson.practiceMinutes,
        }}
        courseTitle={lesson.module.course.title}
        moduleTitle={lesson.module.title}
      />
      <LessonQuestions
        lessonId={lesson.id}
        categories={categories}
        lessonStatus={lesson.status}
        moduleTestEnabled={moduleTest?.enabled ?? false}
        links={questionLinks.map((link) => ({
          questionId: link.questionId,
          teaser: stripMarkdown(link.question.textMd, 120) || "— без текста —",
          category: link.question.category.title,
          status: link.question.status,
          // Заход C.1: тип нужен, чтобы показать последствие привязки — в
          // модульный тест идут только закрытые типы, зато при любой роли.
          type: link.question.type,
          // Заход «Доступ к вопросам», блок 3: у ученика вопрос без эталона не
          // появится так же молча, как черновик, — редактор обязан назвать обе
          // причины по строкам, а не общим счётчиком.
          hasAnswer: hasReferenceAnswer(link.question),
          isKey: link.isKey,
          inQuiz: link.inQuiz,
        }))}
      />
    </div>
  );
}
