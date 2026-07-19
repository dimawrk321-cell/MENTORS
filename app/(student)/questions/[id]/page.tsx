import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getQuestionPublic } from "@/lib/services/questions";
import { getUserCardQuestionIds } from "@/lib/services/srs";
import { parseOptions } from "@/lib/utils/answers";
import { QUESTION_DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/constants";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { AddToSrsButton } from "@/components/features/add-to-srs-button";
import { FlipCard } from "@/components/features/flip-card";
import { QuestionOpenLogger } from "@/components/features/question-open-logger";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { categoryColorVar, categoryTextColor } from "@/lib/utils/category-color";

export const metadata: Metadata = {
  title: "Вопрос",
};

interface QuestionPageProps {
  params: Promise<{ id: string }>;
}

/** FlipCard-просмотр вопроса (spec 7.4/8.3). */
export default async function QuestionPage({ params }: QuestionPageProps) {
  const { user } = await requireStudentZone();
  const { id } = await params;
  const question = await getQuestionPublic(prisma, id);
  if (!question) notFound();
  const inSrs = await getUserCardQuestionIds(prisma, user.id, [question.id]);

  const colorIndex = question.category.parent?.colorIndex ?? question.category.colorIndex;
  const correctOptions = parseOptions(question.options).filter((option) => option.correct);

  const chips = (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <Badge
        style={{
          color: categoryTextColor(colorIndex),
          background: `color-mix(in srgb, ${categoryColorVar(colorIndex)} 12%, transparent)`,
        }}
      >
        {question.category.parent ? `${question.category.parent.title} · ` : ""}
        {question.category.title}
      </Badge>
      <Badge>{QUESTION_TYPE_LABEL[question.type]}</Badge>
      <Badge>{QUESTION_DIFFICULTY_LABEL[question.difficulty]}</Badge>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {/* Logs question.opened + palette recency once on mount (spec 7.11/7.13). */}
      <QuestionOpenLogger questionId={question.id} />
      <BackButton href="/questions" label="Вопросы" />

      <FlipCard
        front={
          <Card className="min-h-[300px]">
            <CardContent className="p-6">
              {chips}
              <div className="lesson-prose text-[16px]">
                <LessonRenderer markdown={question.textMd} />
              </div>
            </CardContent>
          </Card>
        }
        back={
          <Card className="min-h-[300px]">
            <CardContent className="p-6">
              <p className="text-text-3 mb-3 text-[12px] font-medium tracking-wide uppercase">
                Эталонный ответ
              </p>
              <div className="lesson-prose text-[15px]">
                {question.answerMd?.trim() ? (
                  <LessonRenderer markdown={question.answerMd} />
                ) : (
                  <>
                    {correctOptions.length > 0 && (
                      <p>
                        <span className="text-text-2">Правильный ответ: </span>
                        {correctOptions.map((option) => option.text).join("; ")}
                      </p>
                    )}
                    {question.explanationMd?.trim() ? (
                      <LessonRenderer markdown={question.explanationMd} />
                    ) : (
                      correctOptions.length === 0 && (
                        <p className="text-text-2">Разбор появится позже.</p>
                      )
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        }
      />

      <div className="flex justify-center">
        <AddToSrsButton questionId={question.id} initialInSrs={inSrs.has(question.id)} />
      </div>
    </div>
  );
}
