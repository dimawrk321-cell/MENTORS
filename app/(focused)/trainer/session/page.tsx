import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getNextReviewDate, getSessionCards, SRS_SOURCE_LABEL } from "@/lib/services/srs";
import { formatDateOnlyRu } from "@/lib/utils/dates";
import { stripMarkdown } from "@/lib/utils/text";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { QuestionAnswerBody } from "@/components/features/question-answer-body";
import { ReviewSession, type SessionItem } from "@/components/features/review-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Повторения",
};

/**
 * Сессия SRS (spec 7.6): порция 15 карточек. Markdown вопросов и эталонов
 * рендерится сервером (KaTeX/Shiki), клиентский островок получает готовые узлы.
 */
export default async function TrainerSessionPage() {
  const { user } = await requireStudentZone();
  const { cards, queueTotal } = await getSessionCards(prisma, { userId: user.id });

  if (cards.length === 0) {
    const nextReview = await getNextReviewDate(prisma, { userId: user.id });
    return (
      <Card className="mx-auto w-full max-w-xl">
        <EmptyState
          icon={Layers}
          title="Всё повторено"
          description={
            nextReview
              ? `Следующие карточки — ${formatDateOnlyRu(nextReview)}`
              : "Заверши урок — его ключевые вопросы придут сюда."
          }
          action={
            <Button asChild variant="secondary">
              <Link href="/trainer">В тренажёр</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const items: SessionItem[] = cards.map((card) => ({
    cardId: card.cardId,
    sourceLabel: SRS_SOURCE_LABEL[card.addedFrom],
    category: card.category,
    lesson: card.lesson,
    // Компактная строка вопроса над раскрытым ответом — тот же strip, что у
    // строк каталога: разметка в одну строку не нужна.
    questionText: stripMarkdown(card.question.textMd, 160),
    questionNode: <LessonRenderer markdown={card.question.textMd} />,
    answerNode: <QuestionAnswerBody question={card.question} />,
  }));

  // key: после «Продолжить» (router.refresh) новая порция перемонтирует сессию.
  return <ReviewSession key={cards[0]!.cardId} items={items} queueTotal={queueTotal} />;
}
