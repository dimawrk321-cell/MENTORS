import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Dumbbell,
  Layers,
  MessageCircleQuestion,
  Minus,
  Play,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import {
  getLaggingCategories,
  getNextReviewDate,
  getSrsQueue,
  getTrainerStats,
} from "@/lib/services/srs";
import { formatDateOnlyRu, pluralRu } from "@/lib/utils/dates";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CategoryChip } from "@/components/features/category-chip";
import { IconTile } from "@/components/features/icon-tile";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Тренажёр",
};

/** Accuracy is a score, so it gets a score colour — green only when it is good. */
function accuracyTone(accuracy: number | null): string {
  if (accuracy === null) return "";
  if (accuracy >= 0.8) return "text-success";
  if (accuracy >= 0.5) return "text-warning";
  return "text-danger";
}

const TREND = {
  improving: { label: "лучше", tone: "text-success", icon: ArrowDownRight },
  stable: { label: "без изменений", tone: "text-text-3", icon: Minus },
  worsening: { label: "хуже", tone: "text-danger", icon: ArrowUpRight },
  new: { label: "новая статистика", tone: "text-text-3", icon: Minus },
} as const;

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
      <PageHeader title="Тренажёр" subtitle="Интервальные повторения ключевых вопросов" />

      {/* Очередь на сегодня (spec 7.6) */}
      {queue.total > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4">
            <IconTile icon={Layers} colorVar="var(--accent)" size={44} />
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
              description={`Следующие карточки — ${formatDateOnlyRu(nextReview)}`}
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

      {/* Свободная тренировка (заход «Банк вопросов», B1) — второй вход рядом с
          очередью, а не вместо неё: прогон без порога, без расхода очереди и без
          XP. Карточка стоит ниже намеренно — ежедневный ритуал остаётся первым. */}
      <Card interactive className="group">
        <Link href="/trainer/free" className="flex flex-wrap items-center gap-4 p-5">
          <IconTile icon={Dumbbell} colorVar="var(--violet)" size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-text-3 text-[13px]">Свободная тренировка</p>
            <p className="group-hover:text-accent text-[18px] font-semibold">
              Прогон по выбранному набору
            </p>
          </div>
          <ArrowRight
            size={16}
            strokeWidth={1.75}
            className="text-text-3 group-hover:text-accent shrink-0"
            aria-hidden="true"
          />
        </Link>
      </Card>

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
            <p className="text-text-3 mt-1 text-[11px] leading-snug">
              Карточки, прошедшие интервалы 1 → 3 → 7 → 16 → 35 дней
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-text-3 text-[13px]">Точность за 30 дней</p>
            <p
              // The tint follows the VALUE, not the mere presence of data —
              // 12% used to render in success green (audit 13.6).
              className={cn("text-[24px] font-semibold", accuracyTone(stats.accuracy30))}
            >
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
                <li
                  key={entry.categoryId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <CategoryChip title={entry.title} colorIndex={entry.colorIndex} />
                    <p className="text-text-3 mt-1.5 text-[12px]">
                      {entry.againCount} «Не знаю» из {entry.answers} · последняя ошибка{" "}
                      {formatDateOnlyRu(entry.lastAgainAt)}
                    </p>
                  </div>
                  {(() => {
                    const trend = TREND[entry.trend];
                    const TrendIcon = trend.icon;
                    return (
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 text-[12px] ${trend.tone}`}
                      >
                        <TrendIcon size={13} strokeWidth={1.75} aria-hidden="true" />
                        {trend.label}
                      </span>
                    );
                  })()}
                  <span className="text-text-1 shrink-0 text-[14px] font-semibold tabular-nums">
                    {Math.round(entry.againShare * 100)}%
                  </span>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/trainer/free/run?source=category&id=${entry.categoryId}&size=15`}>
                      Потренировать
                    </Link>
                  </Button>
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
            <IconTile icon={MessageCircleQuestion} colorVar="var(--cat-0)" />
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
