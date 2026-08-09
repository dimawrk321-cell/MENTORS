import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import {
  buildFreeTrainingSet,
  FREE_TRAINING_SIZES,
  type FreeTrainingSize,
  type FreeTrainingSource,
} from "@/lib/services/free-training";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { QuestionAnswerBody } from "@/components/features/question-answer-body";
import { FreeSession, type FreeSessionItem } from "@/components/features/free-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Свободная тренировка",
};

interface RunPageProps {
  searchParams: Promise<{ source?: string; id?: string; size?: string; repeat?: string }>;
}

function parseSize(raw: string | undefined): FreeTrainingSize {
  if (raw === "all") return "all";
  const value = Number(raw);
  return (FREE_TRAINING_SIZES as readonly number[]).includes(value)
    ? (value as FreeTrainingSize)
    : 15;
}

function parseSource(raw: string | undefined, id: string | undefined): FreeTrainingSource | null {
  if (raw === "lagging") return { kind: "lagging" };
  if (raw === "category" && id) return { kind: "category", categoryId: id };
  if (raw === "course" && id) return { kind: "course", courseId: id };
  return null;
}

/**
 * Прогон свободной тренировки (B3). Живёт в focused-зоне рядом с сессией
 * повторений: одна задача на экране, без сайдбара и нижней навигации.
 */
export default async function FreeTrainingRunPage({ searchParams }: RunPageProps) {
  const { user } = await requireStudentZone();
  const params = await searchParams;
  const source = parseSource(params.source, params.id);
  const size = parseSize(params.size);

  const setupQuery = new URLSearchParams({ source: params.source ?? "", size: String(size) });
  if (params.id) setupQuery.set("id", params.id);

  const empty = (description: string) => (
    <Card className="mx-auto w-full max-w-xl">
      <EmptyState
        icon={Layers}
        title="Набор пуст"
        description={description}
        action={
          <Button asChild variant="secondary">
            <Link href="/trainer/free">Выбрать другой набор</Link>
          </Button>
        }
      />
    </Card>
  );

  if (!source) return empty("Не понял, что тренировать — выбери набор заново.");

  const questions = await buildFreeTrainingSet(prisma, { userId: user.id, source, size });
  // «Повторить слабые»: тот же набор, суженный до промахов прошлого прогона.
  const repeatIds = params.repeat ? new Set(params.repeat.split(",").filter(Boolean)) : null;
  const selected = repeatIds ? questions.filter((q) => repeatIds.has(q.id)) : questions;

  if (selected.length === 0) {
    return empty(
      "В этом наборе нет доступных вопросов. Они открываются вместе с курсами — загляни позже.",
    );
  }

  const withCategory = await prisma.question.findMany({
    where: { id: { in: selected.map((q) => q.id) } },
    include: { category: { include: { parent: { select: { colorIndex: true } } } } },
  });
  const byId = new Map(withCategory.map((q) => [q.id, q]));

  const links = await prisma.questionLesson.findMany({
    where: { questionId: { in: selected.map((q) => q.id) }, lesson: { status: "published" } },
    include: { lesson: { select: { id: true, title: true } } },
    orderBy: [{ isKey: "desc" }, { createdAt: "asc" }],
  });
  const lessonByQuestion = new Map<string, { id: string; title: string }>();
  for (const link of links) {
    if (!lessonByQuestion.has(link.questionId)) lessonByQuestion.set(link.questionId, link.lesson);
  }

  const items: FreeSessionItem[] = selected.flatMap((question) => {
    const full = byId.get(question.id);
    if (!full) return [];
    return [
      {
        questionId: question.id,
        category: {
          title: full.category.title,
          colorIndex: full.category.parent?.colorIndex ?? full.category.colorIndex,
        },
        lesson: lessonByQuestion.get(question.id) ?? null,
        questionNode: <LessonRenderer markdown={question.textMd} />,
        answerNode: <QuestionAnswerBody question={question} />,
      },
    ];
  });

  return (
    <FreeSession
      key={items[0]!.questionId}
      items={items}
      setupHref={`/trainer/free/run?${setupQuery.toString()}`}
    />
  );
}
