"use client";

// KaTeX styles for the lazily-injected эталон HTML (walk 13.5): the catalog no
// longer renders LessonRenderer, so this page must carry the KaTeX CSS itself
// (Shiki theme CSS is global in globals.css). Without it injected math is unstyled.
import "katex/dist/katex.min.css";

import { useCallback, useState, type SyntheticEvent } from "react";
import Link from "next/link";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import type { CatalogGroup, CatalogGroupQuestion } from "@/lib/services/questions";
import { QUESTION_DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/constants";
import { AddToSrsButton } from "@/components/features/add-to-srs-button";
import { CategoryChip } from "@/components/features/category-chip";
import { cn } from "@/lib/utils/cn";

// Catalog accordion + lazy answers (walk 13.5): sections/rows render (SSR'd +
// hydrated) with only cheap teasers. The эталон (answer_md, KaTeX/Shiki) is fetched
// from /api/questions/[id]/answer the FIRST time a row is opened, shown behind a
// skeleton, and cached — so zero answers load on page open and the first catalog
// load is light. The native <details> accordion + grouping are unchanged.

interface CatalogPayload {
  questionHtml: string | null;
  answerHtml: string;
}

type RowState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | ({ status: "ready" } & CatalogPayload);

// Module-level cache: survives collapse/reopen and re-renders within the session
// (spec: «кэш на клиенте»). Keyed by question id — ids are unique.
const answerCache = new Map<string, CatalogPayload>();

function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-2 py-1" aria-hidden="true">
      <div className="bg-surface-2 h-3.5 w-11/12 animate-pulse rounded" />
      <div className="bg-surface-2 h-3.5 w-4/5 animate-pulse rounded" />
      <div className="bg-surface-2 h-3.5 w-2/3 animate-pulse rounded" />
    </div>
  );
}

function CatalogRow({ question, inSrs }: { question: CatalogGroupQuestion; inSrs: boolean }) {
  const [state, setState] = useState<RowState>(() => {
    const cached = answerCache.get(question.id);
    return cached ? { status: "ready", ...cached } : { status: "idle" };
  });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/questions/${question.id}/answer`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as CatalogPayload;
      answerCache.set(question.id, data);
      setState({ status: "ready", ...data });
    } catch {
      setState({ status: "error" });
    }
  }, [question.id]);

  // Native <details> toggles instantly; the answer loads on the first open only.
  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open && state.status === "idle") void load();
  }

  return (
    <details className="group/row border-border/70 border-b last:border-b-0" onToggle={onToggle}>
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
            !question.isShort && "truncate",
          )}
        >
          {question.teaser}
        </span>
        <span className="text-text-3 shrink-0 text-[12px] whitespace-nowrap">
          <span className="hidden sm:inline">{QUESTION_TYPE_LABEL[question.type]} · </span>
          {QUESTION_DIFFICULTY_LABEL[question.difficulty]}
        </span>
        <span className="shrink-0">
          <AddToSrsButton questionId={question.id} initialInSrs={inSrs} iconOnly />
        </span>
      </summary>

      <div className="lesson-prose text-text-2 mb-3 pl-[26px] text-[14px]">
        {state.status === "error" ? (
          <p className="text-text-3 text-[13px]">
            Не удалось загрузить ответ.{" "}
            <button
              type="button"
              onClick={() => void load()}
              className="text-accent hover:text-accent-hover underline"
            >
              Повторить
            </button>
          </p>
        ) : state.status !== "ready" ? (
          <AnswerSkeleton />
        ) : (
          <>
            {!question.isShort && state.questionHtml && (
              <div
                className="lesson-prose text-text-1 mb-3 text-[14px] font-medium"
                dangerouslySetInnerHTML={{ __html: state.questionHtml }}
              />
            )}
            {/* Injected HTML comes from renderMarkdownHtml, which has neither
                Shiki nor the TableWrap mapping the lesson pipeline uses — so wide
                code and tables would be clipped by the details' overflow-hidden.
                Scroll them here (audit 13.6). */}
            <div
              className="[&_pre]:rounded-control [&_pre]:border-border [&_pre]:bg-surface-2 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:p-3 [&_table]:block [&_table]:overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: state.answerHtml }}
            />
            {question.lessonId && (
              <Link
                href={`/lessons/${question.lessonId}`}
                className="text-accent hover:text-accent-hover mt-3 inline-flex items-center gap-1 text-[13px] font-medium"
              >
                <BookOpen size={14} strokeWidth={1.75} aria-hidden="true" />
                Открыть урок
              </Link>
            )}
          </>
        )}
      </div>
    </details>
  );
}

export function CatalogAccordion({
  groups,
  inSrsIds,
  anyFilter,
}: {
  groups: CatalogGroup[];
  inSrsIds: string[];
  anyFilter: boolean;
}) {
  const inSrs = new Set(inSrsIds);
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group, index) => (
        // По умолчанию открыта первая секция; при активном фильтре — все (spec 1.1).
        <details
          key={group.categoryId}
          open={anyFilter || index === 0}
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
            {group.questions.map((question) => (
              <li key={question.id}>
                <CatalogRow question={question} inSrs={inSrs.has(question.id)} />
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
