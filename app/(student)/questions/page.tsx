import type { Metadata } from "next";
import Link from "next/link";
import type { QuestionType } from "@prisma/client";
import { MessageCircleQuestion, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { listQuestionsCatalogGrouped } from "@/lib/services/questions";
import { getLaggingQuestionIds, getUserCardQuestionIds } from "@/lib/services/srs";
import { getQuestionAccess } from "@/lib/services/question-access";
import { QUESTION_DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/constants";
import { CatalogAccordion } from "@/components/features/catalog-accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Вопросы",
};

const TYPES: QuestionType[] = ["open", "single", "multi", "tf", "short_text"];

interface QuestionsPageProps {
  searchParams: Promise<{
    q?: string;
    type?: string;
    difficulty?: string;
    lagging?: string;
    category?: string;
  }>;
}

function filterHref(
  params: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...patch })) {
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `/questions?${qs}` : "/questions";
}

/**
 * Каталог вопросов (spec 7.4/8.3, walk 13.5 block 1): группировка по категориям в
 * сворачиваемые секции + инлайн-аккордеон тем вместо простыни карточек.
 */
export default async function QuestionsPage({ searchParams }: QuestionsPageProps) {
  const { user } = await requireStudentZone();
  const params = await searchParams;
  const type = TYPES.includes(params.type as QuestionType)
    ? (params.type as QuestionType)
    : undefined;
  const difficulty = ["1", "2", "3"].includes(params.difficulty ?? "")
    ? (Number(params.difficulty) as 1 | 2 | 3)
    : undefined;
  const lagging = params.lagging === "1";
  const anyFilter = Boolean(params.q?.trim() || type || difficulty || lagging || params.category);
  // «Мои западающие» — единственный активный фильтр (для пустого состояния 5.5):
  // отдельный предикат, т.к. lagging входит в anyFilter (иначе ветка недостижима).
  const laggingOnly = lagging && !params.q?.trim() && !type && !difficulty;

  // «Мои западающие» (spec 7.4 + этап 4): lapses ≥ 1 или карточка из ошибок.
  const laggingIds = lagging ? await getLaggingQuestionIds(prisma, user.id) : undefined;

  // Заход «Банк вопросов»: каталог показывает только категории открытых курсов
  // плюс общий пул. Категории запертых курсов не помечаются замком — их просто
  // нет, как скрытых разделов справочника (12.1/C3).
  const access = await getQuestionAccess(prisma, user.id);

  const { groups, total } = await listQuestionsCatalogGrouped(prisma, {
    q: params.q?.trim() || undefined,
    categoryId: params.category || undefined,
    type,
    difficulty,
    ids: laggingIds,
    allowedCategoryIds: [...access.categoryIds],
  });
  const inSrs = await getUserCardQuestionIds(
    prisma,
    user.id,
    groups.flatMap((group) => group.questions.map((question) => question.id)),
  );

  const plain = {
    q: params.q,
    type: params.type,
    difficulty: params.difficulty,
    lagging: params.lagging,
    category: params.category,
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Вопросы"
        subtitle="Банк вопросов с реальных собеседований — фильтруй по теме или отмечай в повторения."
      />

      {/* Облегчённая шапка фильтров (spec 13.5 1.4): поиск + один ряд чипов.
          Ряд категорий убран — его роль выполняет группировка ниже. */}
      <form className="flex max-w-md gap-2" role="search">
        {params.type && <input type="hidden" name="type" value={params.type} />}
        {params.difficulty && <input type="hidden" name="difficulty" value={params.difficulty} />}
        {params.lagging && <input type="hidden" name="lagging" value={params.lagging} />}
        {params.category && <input type="hidden" name="category" value={params.category} />}
        <Input
          type="search"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Поиск по тексту вопроса"
          aria-label="Поиск по тексту вопроса"
        />
        <Button type="submit" variant="secondary">
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          Найти
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-text-3">Сложность:</span>
          {[1, 2, 3].map((level) => {
            const active = params.difficulty === String(level);
            return (
              <Link
                key={level}
                href={filterHref(plain, { difficulty: active ? undefined : String(level) })}
                className={cn(
                  "rounded-pill ease-app flex h-7 items-center border px-2.5 transition-colors duration-150",
                  active
                    ? "border-accent bg-accent/12 text-accent"
                    : "border-border text-text-2 hover:border-border-strong hover:text-text-1",
                )}
              >
                {QUESTION_DIFFICULTY_LABEL[level]}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-text-3">Тип:</span>
          {TYPES.map((option) => {
            const active = params.type === option;
            return (
              <Link
                key={option}
                href={filterHref(plain, { type: active ? undefined : option })}
                className={cn(
                  "rounded-pill ease-app flex h-7 items-center border px-2.5 transition-colors duration-150",
                  active
                    ? "border-accent bg-accent/12 text-accent"
                    : "border-border text-text-2 hover:border-border-strong hover:text-text-1",
                )}
              >
                {QUESTION_TYPE_LABEL[option]}
              </Link>
            );
          })}
        </div>
        <Link
          href={filterHref(plain, { lagging: lagging ? undefined : "1" })}
          className={cn(
            "rounded-pill ease-app flex h-7 items-center border px-2.5 transition-colors duration-150",
            lagging
              ? "border-warning bg-warning/12 text-warning"
              : "border-border text-text-2 hover:border-border-strong hover:text-text-1",
          )}
        >
          Мои западающие
        </Link>
      </div>

      {total === 0 ? (
        <Card>
          <EmptyState
            icon={MessageCircleQuestion}
            title={
              laggingOnly
                ? "Западающих вопросов нет"
                : !anyFilter
                  ? "Банк вопросов наполняется"
                  : "Ничего не нашлось"
            }
            description={
              laggingOnly
                ? "Сюда попадают вопросы, на которых ты ошибался в квизах, тестах и повторениях."
                : !anyFilter
                  ? "Вопросы появятся после импорта базы."
                  : "Попробуй изменить запрос или фильтры."
            }
          />
        </Card>
      ) : (
        <>
          {/* Аккордеон + ленивая подгрузка эталона при раскрытии (walk 13.5). */}
          <CatalogAccordion groups={groups} inSrsIds={[...inSrs]} anyFilter={anyFilter} />
        </>
      )}
    </div>
  );
}
