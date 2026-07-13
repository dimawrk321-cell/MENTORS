import type { Metadata } from "next";
import Link from "next/link";
import type { QuestionType } from "@prisma/client";
import { MessageCircleQuestion, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { listCategoriesTree, listQuestionsCatalog } from "@/lib/services/questions";
import { getLaggingQuestionIds, getUserCardQuestionIds } from "@/lib/services/srs";
import { stripMarkdown } from "@/lib/utils/text";
import { QUESTION_DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/constants";
import { AddToSrsButton } from "@/components/features/add-to-srs-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Вопросы",
};

const TYPES: QuestionType[] = ["open", "single", "multi", "tf", "short_text"];

interface QuestionsPageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    type?: string;
    difficulty?: string;
    lagging?: string;
    page?: string;
  }>;
}

function filterHref(
  params: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...patch, page: patch.page })) {
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `/questions?${qs}` : "/questions";
}

/** Каталог вопросов (spec 7.4/8.3); FTS — этап 8. */
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
  const page = Math.max(1, Number(params.page) || 1);

  // «Мои западающие» (spec 7.4 + этап 4): lapses ≥ 1 или карточка из ошибок.
  const laggingIds = lagging ? await getLaggingQuestionIds(prisma, user.id) : undefined;

  const [categories, catalog] = await Promise.all([
    listCategoriesTree(prisma),
    listQuestionsCatalog(prisma, {
      q: params.q?.trim() || undefined,
      categoryId: params.category,
      type,
      difficulty,
      ids: laggingIds,
      page,
    }),
  ]);
  const inSrs = await getUserCardQuestionIds(
    prisma,
    user.id,
    catalog.items.map((question) => question.id),
  );
  const totalPages = Math.max(1, Math.ceil(catalog.total / catalog.pageSize));
  const plain = {
    q: params.q,
    category: params.category,
    type: params.type,
    difficulty: params.difficulty,
    lagging: params.lagging,
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[24px] font-semibold">Вопросы</h1>

      {/* Поиск + фильтры (тип и сложность держатся в hidden-полях формы) */}
      <form className="flex max-w-md gap-2" role="search">
        {params.category && <input type="hidden" name="category" value={params.category} />}
        {params.type && <input type="hidden" name="type" value={params.type} />}
        {params.difficulty && <input type="hidden" name="difficulty" value={params.difficulty} />}
        {params.lagging && <input type="hidden" name="lagging" value={params.lagging} />}
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

      {/* Категории — цветные чипы (spec 5.1/7.4) */}
      <div className="flex flex-wrap gap-1.5">
        <Link
          href={filterHref(plain, { category: undefined })}
          className={cn(
            "rounded-pill ease-app flex h-8 items-center border px-3 text-[13px] transition-colors duration-150",
            !params.category
              ? "border-accent bg-accent/12 text-accent"
              : "border-border text-text-2 hover:border-border-strong hover:text-text-1",
          )}
        >
          Все категории
        </Link>
        {categories.map((category) => {
          const active = params.category === category.id;
          return (
            <Link
              key={category.id}
              href={filterHref(plain, { category: active ? undefined : category.id })}
              style={
                active
                  ? {
                      color: `var(--cat-${category.colorIndex})`,
                      borderColor: `color-mix(in srgb, var(--cat-${category.colorIndex}) 50%, transparent)`,
                      background: `color-mix(in srgb, var(--cat-${category.colorIndex}) 12%, transparent)`,
                    }
                  : undefined
              }
              className={cn(
                "rounded-pill ease-app flex h-8 items-center border px-3 text-[13px] transition-colors duration-150",
                !active && "border-border text-text-2 hover:border-border-strong hover:text-text-1",
              )}
            >
              {category.title}
            </Link>
          );
        })}
      </div>

      {/* Тип, сложность и «мои западающие» */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
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

      {catalog.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageCircleQuestion}
            title={
              lagging && !params.q
                ? "Западающих вопросов нет"
                : catalog.total === 0 && !params.q
                  ? "Банк вопросов наполняется"
                  : "Ничего не нашлось"
            }
            description={
              lagging && !params.q
                ? "Сюда попадают вопросы, на которых ты ошибался в квизах, тестах и повторениях."
                : catalog.total === 0 && !params.q
                  ? "Вопросы появятся после импорта базы."
                  : "Попробуй изменить запрос или фильтры."
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.items.map((question) => {
              const colorIndex =
                question.category.parent?.colorIndex ?? question.category.colorIndex;
              return (
                <Card key={question.id} interactive className="group relative h-full">
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    {/* Stretched link: вся карточка кликабельна, кнопка — поверх. */}
                    <Link
                      href={`/questions/${question.id}`}
                      className="text-text-1 group-hover:text-accent text-[14px] leading-relaxed font-medium after:absolute after:inset-0 after:content-['']"
                    >
                      {stripMarkdown(question.textMd, 140) || "Без текста"}
                    </Link>
                    <div className="mt-auto flex flex-wrap items-center gap-1.5">
                      <Badge
                        style={{
                          color: `var(--cat-${colorIndex})`,
                          background: `color-mix(in srgb, var(--cat-${colorIndex}) 12%, transparent)`,
                        }}
                      >
                        {question.category.title}
                      </Badge>
                      <Badge>{QUESTION_TYPE_LABEL[question.type]}</Badge>
                      <Badge>{QUESTION_DIFFICULTY_LABEL[question.difficulty]}</Badge>
                      <span className="relative z-10 ml-auto">
                        <AddToSrsButton
                          questionId={question.id}
                          initialInSrs={inSrs.has(question.id)}
                          size="sm"
                        />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="text-text-2 flex items-center justify-center gap-3 text-[13px]">
              {page > 1 ? (
                <Link
                  href={filterHref(plain, { page: String(page - 1) })}
                  className="hover:text-text-1"
                >
                  ← Назад
                </Link>
              ) : (
                <span className="text-text-3">← Назад</span>
              )}
              <span className="text-text-3">
                {page} из {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={filterHref(plain, { page: String(page + 1) })}
                  className="hover:text-text-1"
                >
                  Дальше →
                </Link>
              ) : (
                <span className="text-text-3">Дальше →</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
