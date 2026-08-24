import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getLessonForEditor } from "@/lib/services/content-admin";
import {
  listCategoriesTree,
  listLessonQuestionLinks,
  suggestQuestionCategory,
} from "@/lib/services/questions";
import { hasReferenceAnswer } from "@/lib/services/question-access";
import { stripMarkdown } from "@/lib/utils/text";
import { LessonEditor } from "./lesson-editor";
import { LessonQuestions } from "./lesson-questions";
import { LessonSteps } from "./lesson-steps";

export const metadata: Metadata = {
  title: "Редактор урока",
};

interface EditorPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}

/** Two-pane lesson editor (spec 8.5): markdown ↔ live preview + metadata. */
export default async function LessonEditorPage({ params, searchParams }: EditorPageProps) {
  await requirePermission("content.manage");
  const { id } = await params;
  const lesson = await getLessonForEditor(prisma, id);
  if (!lesson) notFound();
  const { step: requestedStepId } = await searchParams;
  const activeStep =
    lesson.steps.find((step) => step.id === requestedStepId) ?? lesson.steps[0] ?? null;
  const [questionLinks, categoryTree, moduleTest, categorySuggestion] = await Promise.all([
    listLessonQuestionLinks(prisma, lesson.id),
    listCategoriesTree(prisma),
    // Заход C.1: секция «Вопросы урока» показывает, какие привязки идут в
    // модульный тест, — а это имеет смысл только когда тест у модуля есть и
    // включён.
    prisma.moduleTest.findUnique({
      where: { moduleId: lesson.moduleId },
      select: { enabled: true },
    }),
    // Заход C.6, 1.3: умолчание категории для быстрого создания — по фактическим
    // привязкам урока/модуля/курса (связи «курс ↔ категории банка» пусты).
    suggestQuestionCategory(prisma, lesson.id),
  ]);
  const [courseModules, allCourseContent] = await Promise.all([
    prisma.module.findMany({
      where: { courseId: lesson.module.course.id },
      orderBy: { order: "asc" },
      select: {
        id: true,
        title: true,
        lessons: { orderBy: { order: "asc" }, select: { id: true, title: true } },
      },
    }),
    prisma.course.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        modules: {
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            lessons: {
              orderBy: [{ order: "asc" }, { createdAt: "asc" }],
              select: { id: true, title: true },
            },
          },
        },
      },
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
      <LessonSteps
        lessonId={lesson.id}
        lessonTitle={lesson.title}
        lessonStatus={lesson.status}
        moduleId={lesson.moduleId}
        steps={lesson.steps}
        activeStepId={activeStep?.id ?? null}
        modules={courseModules.map((module) => ({ id: module.id, title: module.title }))}
        lessons={courseModules.flatMap((module) =>
          module.lessons.map((item) => ({ id: item.id, title: `${module.title} · ${item.title}` })),
        )}
        copyTargets={allCourseContent.flatMap((course) =>
          course.modules.map((module) => ({
            id: module.id,
            title: `${course.title} · ${module.title}`,
          })),
        )}
        lessonSources={allCourseContent.flatMap((course) =>
          course.modules.flatMap((module) =>
            module.lessons.map((item) => ({
              id: item.id,
              title: item.title,
              label: `${course.title} · ${module.title} · ${item.title}`,
            })),
          ),
        )}
      />
      <LessonEditor
        key={activeStep?.id ?? "legacy"}
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
        activeStep={activeStep}
        courseTitle={lesson.module.course.title}
        moduleTitle={lesson.module.title}
      />
      <LessonQuestions
        lessonId={lesson.id}
        categories={categories}
        lessonStatus={lesson.status}
        moduleTestEnabled={moduleTest?.enabled ?? false}
        defaultCategoryId={categorySuggestion?.categoryId ?? ""}
        defaultCategoryScope={categorySuggestion?.scope ?? null}
        steps={lesson.steps.map((step) => ({ id: step.id, title: step.title }))}
        activeStepId={activeStep?.id ?? null}
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
          stepId: link.stepId,
        }))}
      />
    </div>
  );
}
