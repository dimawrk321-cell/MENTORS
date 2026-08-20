import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { listCategoriesTree, listLessonsForLinking } from "@/lib/services/questions";
import { CLOSED_QUESTION_TYPES, parseAcceptedAnswers, parseOptions } from "@/lib/utils/answers";
import { QuestionEditor } from "./question-editor";

export const metadata: Metadata = {
  title: "Редактор вопроса",
};

interface QuestionEditorPageProps {
  params: Promise<{ id: string }>;
}

/** Редактор вопроса (spec 8.5): тип-специфичные поля + KaTeX-превью + привязки. */
export default async function QuestionEditorPage({ params }: QuestionEditorPageProps) {
  await requirePermission("content.manage");
  const { id } = await params;
  const question = await prisma.question.findUnique({
    where: { id },
    include: {
      lessonLinks: {
        include: {
          lesson: {
            select: {
              id: true,
              title: true,
              // Заход C.2: чтобы сказать ментору, уводит ли публикация вопрос в
              // боевые попытки, нужны статус урока и включённость теста модуля.
              status: true,
              module: {
                select: {
                  title: true,
                  test: { select: { enabled: true } },
                  course: { select: { title: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!question) notFound();

  const [categoriesTree, lessons] = await Promise.all([
    listCategoriesTree(prisma),
    listLessonsForLinking(prisma),
  ]);
  const categoryOptions = categoriesTree.flatMap((root) => [
    { id: root.id, label: root.title },
    ...root.children.map((child) => ({ id: child.id, label: `— ${child.title}` })),
  ]);

  return (
    <QuestionEditor
      question={{
        id: question.id,
        type: question.type,
        status: question.status,
        categoryId: question.categoryId,
        textMd: question.textMd,
        answerMd: question.answerMd ?? "",
        explanationMd: question.explanationMd ?? "",
        options: parseOptions(question.options),
        acceptedAnswers: parseAcceptedAnswers(question.acceptedAnswers),
        difficulty: question.difficulty as 1 | 2 | 3,
        needsLatex: question.needsLatex,
        source: question.source,
      }}
      categories={categoryOptions}
      lessons={lessons}
      // Заход C.2: модули, чей включённый тест уже забирает (или заберёт при
      // публикации) этот вопрос. Условие — то же `poolEligible`, но статус
      // вопроса намеренно НЕ проверяется: для черновика ответ нужен ДО клика
      // «Опубликовать», иначе предупреждение опаздывает на действие.
      liveTestModules={[
        ...new Set(
          question.lessonLinks
            .filter(
              (link) =>
                CLOSED_QUESTION_TYPES.includes(
                  question.type as (typeof CLOSED_QUESTION_TYPES)[number],
                ) &&
                link.lesson.status === "published" &&
                link.lesson.module.test?.enabled === true,
            )
            .map((link) => `${link.lesson.module.course.title} · ${link.lesson.module.title}`),
        ),
      ]}
      links={question.lessonLinks.map((link) => ({
        lessonId: link.lessonId,
        label: `${link.lesson.module.course.title} · ${link.lesson.module.title} · ${link.lesson.title}`,
        isKey: link.isKey,
        inQuiz: link.inQuiz,
      }))}
    />
  );
}
