import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Layers, MessageCircleQuestion, Play } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import {
  getLaggingCategories,
  getNextReviewDate,
  getSrsQueue,
  getTrainerStats,
} from "@/lib/services/srs";
import { formatDateOnlyRu, pluralRu } from "@/lib/utils/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { categoryColorVar } from "@/lib/utils/category-color";

export const metadata: Metadata = {
  title: "Тренажёр",
};

/** Хаб тренажёра (spec 8.3): очередь, статистика, западающие темы, каталог. */
export default async function TrainerPage() {
  const { user } = await requireStudentZone();
  const [queue, stats, lagging] = await Promise.all([
    getSrsQueue(prisma, { userId: user.id }),
    getTrainerStats(prisma, { userId: user.id }),
    getLaggingCategories(prisma, { userId: user.id }),
  ]);
  const nextReview =
    queue.total === 0 ? await getNextReviewDate(prisma, { userId: user.id }) : null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[24px] font-semibold">Тренажёр</h1>

      {/* Очередь на сегодня (spec 7.6) */}
      {queue.total > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4">
            <div className="rounded-pill border-border bg-surface-2 flex size-10 shrink-0 items-center justify-center border">
              <Layers size={20} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-text-3 text-[13px]">Очередь на сегодня</p>
              <p className="text-[18px] font-semibold">
                {queue.total} {pluralRu(queue.total, "карточка", "карточки", "карточек")} · ~
                {queue.estimateMinutes} мин
              </p>
            </div>
            <Button asChild>
              <Link href="/trainer/session">
                <Play size={15} strokeWidth={1.75} aria-hidden="true" />
                Начать
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          {nextReview ? (
            <EmptyState
              icon={Layers}
              title="Всё повторено"
              description={`Следующие карточки — ${formatDateOnlyRu(nextReview)}.`}
            />
          ) : (
            <EmptyState
              icon={Layers}
              title="Карточек пока нет"
              description="Заверши урок — его ключевые вопросы придут сюда. Или добавь вопросы из каталога вручную."
              action={
                <Button asChild variant="secondary">
                  <Link href="/questions">Открыть каталог</Link>
                </Button>
              }
            />
          )}
        </Card>
      )}

      {/* Статистика */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-text-3 text-[13px]">Отвечено всего</p>
            <p className="text-[24px] font-semibold">{stats.answeredTotal}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-text-3 text-[13px]">Выучено</p>
            <p className="text-[24px] font-semibold">{stats.learnedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-text-3 text-[13px]">Точность за 30 дней</p>
            <p className="text-[24px] font-semibold">
              {stats.accuracy30 === null ? "—" : `${Math.round(stats.accuracy30 * 100)}%`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Западающие темы (spec 8.3): топ-3 по доле again, скрыт при <20 ответов */}
      {lagging !== null && lagging.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Западающие темы</h2>
          <Card>
            <ul className="divide-border divide-y">
              {lagging.map((entry) => (
                <li key={entry.categoryId} className="flex items-center gap-3 px-5 py-3.5">
                  <Badge
                    style={{
                      color: categoryColorVar(entry.colorIndex),
                      background: `color-mix(in srgb, ${categoryColorVar(entry.colorIndex)} 12%, transparent)`,
                    }}
                  >
                    {entry.title}
                  </Badge>
                  <span className="text-text-2 ml-auto text-[13px]">
                    {Math.round(entry.againShare * 100)}% «не знаю» · {entry.answers}{" "}
                    {pluralRu(entry.answers, "ответ", "ответа", "ответов")}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Ссылка в каталог вопросов */}
      <Link href="/questions" className="group">
        <Card interactive>
          <CardContent className="flex items-center gap-4">
            <div className="rounded-pill border-border bg-surface-2 flex size-10 shrink-0 items-center justify-center border">
              <MessageCircleQuestion
                size={20}
                strokeWidth={1.75}
                className="text-text-3"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="group-hover:text-accent text-[15px] font-medium">Каталог вопросов</p>
              <p className="text-text-2 text-[13px]">
                Весь банк с фильтрами — любой вопрос можно добавить в повторения.
              </p>
            </div>
            <ArrowRight size={16} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
