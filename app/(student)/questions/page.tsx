import type { Metadata } from "next";
import Link from "next/link";
import type { QuestionType } from "@prisma/client";
import { BookOpen, ChevronDown, ChevronRight, MessageCircleQuestion, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { listQuestionsCatalogGrouped } from "@/lib/services/questions";
import { getLaggingQuestionIds, getUserCardQuestionIds } from "@/lib/services/srs";
import { stripMarkdown } from "@/lib/utils/text";
import { QUESTION_DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/constants";
import { AddToSrsButton } from "@/components/features/add-to-srs-button";
import { CategoryChip } from "@/components/features/category-chip";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { QuestionAnswerBody } from "@/components/features/question-answer-body";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Вопросы",
};

const TYPES: QuestionType[] = ["open", "single", "multi", "tf", "short_text"];

/** Row teaser: whole stripped text for short questions, else ~80 chars at a word break. */
const TEASER_MAX = 80;

interface QuestionsPageProps {
  searchParams: Promise<{
    q?: string;
    type?: string;
    difficulty?: string;
    lagging?: string;
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

function teaserFor(textMd: string): { teaser: string; isShort: boolean } {
  const full = stripMarkdown(textMd, 100_000) || "Без текста";
  if (full.length <= TEASER_MAX) return { teaser: full, isShort: true };
  const slice = full.slice(0, TEASER_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > TEASER_MAX * 0.6 ? slice.slice(0, lastSpace) : slice;
  return { teaser: `${cut.trimEnd()}…`, isShort: false };
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
  const anyFilter = Boolean(params.q?.trim() || type || difficulty || lagging);
  // «Мои западающие» — единственный активный фильтр (для пустого состояния 5.5):
  // отдельный предикат, т.к. lagging входит в anyFilter (иначе ветка недостижима).
  const laggingOnly = lagging && !params.q?.trim() && !type && !difficulty;

  // «Мои западающие» (spec 7.4 + этап 4): lapses ≥ 1 или карточка из ошибок.
  const laggingIds = lagging ? await getLaggingQuestionIds(prisma, user.id) : undefined;

  const { groups, total } = await listQuestionsCatalogGrouped(prisma, {
    q: params.q?.trim() || undefined,
    type,
    difficulty,
    ids: laggingIds,
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
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[24px] font-semibold">Вопросы</h1>

      {/* Облегчённая шапка фильтров (spec 13.5 1.4): поиск + один ряд чипов.
          Ряд категорий убран — его роль выполняет группировка ниже. */}
      <form className="flex max-w-md gap-2" role="search">
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
          {/* Подсказка новичку (spec 13.5 1.6): показывается без активного фильтра. */}
          {!anyFilter && (
            <p className="text-text-3 text-[13px]">
              Это банк вопросов с реальных собеседований — фильтруй по теме или отмечай в
              повторения.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {groups.map((group, index) => {
              // По умолчанию открыта первая секция; при активном фильтре — все (spec 1.1).
              const open = anyFilter || index === 0;
              return (
                <details
                  key={group.categoryId}
                  open={open}
                  className="rounded-card border-border bg-surface-1 group/cat overflow-hidden border"
                >
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-2.5 select-none [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      size={16}
                      strokeWidth={1.75}
                      className="text-text-3 ease-app shrink-0 transition-transform duration-200 group-open/cat:rotate-180"
                      aria-hidden="true"
                    />
                    <CategoryChip title={group.title} colorIndex={group.colorIndex} />
                    <span className="text-text-3 shrink-0 text-[13px] tabular-nums">
                      {group.questions.length}
                    </span>
                  </summary>

                  <ul className="border-border border-t px-3 sm:px-4">
                    {group.questions.map((question) => {
                      const { teaser, isShort } = teaserFor(question.textMd);
                      return (
                        <li key={question.id}>
                          <details className="group/row border-border/70 border-b last:border-b-0">
                            {/* Кнопка-иконка «В повторения» — в summary (видна на свёрнутой
                                строке); её клик не тогглит строку (stopPropagation). */}
                            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-1.5 select-none [&::-webkit-details-marker]:hidden">
                              <ChevronRight
                                size={15}
                                strokeWidth={1.75}
                                className="text-text-3 ease-app shrink-0 transition-transform duration-150 group-open/row:rotate-90"
                                aria-hidden="true"
                              />
                              <span
                                className={cn(
                                  "text-text-1 min-w-0 flex-1 text-[14px] leading-snug",
                                  !isShort && "truncate",
                                )}
                              >
                                {teaser}
                              </span>
                              <span className="text-text-3 shrink-0 text-[12px] whitespace-nowrap">
                                <span className="hidden sm:inline">
                                  {QUESTION_TYPE_LABEL[question.type]} ·{" "}
                                </span>
                                {QUESTION_DIFFICULTY_LABEL[question.difficulty]}
                              </span>
                              <span className="shrink-0">
                                <AddToSrsButton
                                  questionId={question.id}
                                  initialInSrs={inSrs.has(question.id)}
                                  iconOnly
                                />
                              </span>
                            </summary>

                            <div className="lesson-prose text-text-2 mb-3 pl-[26px] text-[14px]">
                              {!isShort && (
                                <div className="lesson-prose text-text-1 mb-3 text-[14px] font-medium">
                                  <LessonRenderer markdown={question.textMd} />
                                </div>
                              )}
                              <QuestionAnswerBody question={question} />
                              {question.lessonId && (
                                <Link
                                  href={`/lessons/${question.lessonId}`}
                                  className="text-accent hover:text-accent-hover mt-3 inline-flex items-center gap-1 text-[13px] font-medium"
                                >
                                  <BookOpen size={14} strokeWidth={1.75} aria-hidden="true" />
                                  Открыть урок
                                </Link>
                              )}
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
