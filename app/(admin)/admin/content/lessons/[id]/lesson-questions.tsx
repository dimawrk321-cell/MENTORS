"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Link2, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/auth/action-helpers";
import {
  removeQuestionLinkAction,
  searchQuestionsAction,
  upsertQuestionLinkAction,
} from "@/lib/actions/questions-admin";

export interface LessonQuestionLinkRow {
  questionId: string;
  teaser: string;
  category: string;
  status: "draft" | "published";
  isKey: boolean;
  inQuiz: boolean;
}

interface SearchRow {
  id: string;
  textMd: string;
  category: string;
  status: string;
}

/** Привязка вопросов из редактора урока (spec 8.5): поиск по банку + флаги. */
export function LessonQuestions({
  lessonId,
  links,
}: {
  lessonId: string;
  links: LessonQuestionLinkRow[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const linkedIds = new Set(links.map((link) => link.questionId));

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void searchQuestionsAction(query.trim()).then((result) => {
        setSearching(false);
        if (result?.ok) setResults(result.data);
      });
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  function run(action: () => Promise<ActionResult<unknown>>, success?: string): void {
    startTransition(async () => {
      const result = await action();
      if (!result) return;
      if (result.ok) {
        if (success) toast({ title: success, variant: "success" });
        router.refresh();
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  return (
    <section className="rounded-card border-border bg-surface-1 border p-4">
      <h2 className="mb-1 flex items-center gap-2 text-[16px] font-semibold">
        <Link2 size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        Вопросы урока
      </h2>
      <p className="text-text-3 mb-3 text-[13px]">
        is_key попадают в «Ключевые вопросы» (и в SRS с этапа 4), in_quiz — в квиз урока.
      </p>

      {links.length === 0 ? (
        <p className="text-text-3 mb-4 text-[13px]">Пока ничего не привязано.</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {links.map((link) => (
            <li key={link.questionId} className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className="min-w-0 flex-1 truncate">
                {link.teaser}
                <span className="text-text-3 ml-2">· {link.category}</span>
              </span>
              {link.status === "draft" && <Badge>черновик</Badge>}
              <label className="text-text-2 flex items-center gap-1.5">
                <Switch
                  checked={link.isKey}
                  onCheckedChange={(isKey) =>
                    run(() =>
                      upsertQuestionLinkAction({
                        questionId: link.questionId,
                        lessonId,
                        isKey,
                        inQuiz: link.inQuiz,
                      }),
                    )
                  }
                />
                is_key
              </label>
              <label className="text-text-2 flex items-center gap-1.5">
                <Switch
                  checked={link.inQuiz}
                  onCheckedChange={(inQuiz) =>
                    run(() =>
                      upsertQuestionLinkAction({
                        questionId: link.questionId,
                        lessonId,
                        isKey: link.isKey,
                        inQuiz,
                      }),
                    )
                  }
                />
                in_quiz
              </label>
              <button
                type="button"
                aria-label="Отвязать вопрос"
                onClick={() =>
                  run(
                    () => removeQuestionLinkAction({ questionId: link.questionId, lessonId }),
                    "Отвязано",
                  )
                }
                className="rounded-control text-text-3 hover:text-danger flex size-7 items-center justify-center"
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <div className="relative max-w-md">
          <Search
            size={14}
            strokeWidth={1.75}
            className="text-text-3 absolute top-1/2 left-3 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по банку вопросов"
            className="pl-8"
            aria-label="Поиск по банку вопросов"
          />
        </div>
        {searching && <p className="text-text-3 text-[12px]">Ищу…</p>}
        {results.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {results
              .filter((row) => !linkedIds.has(row.id))
              .map((row) => (
                <li key={row.id} className="flex items-center gap-3 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">
                    {row.textMd.slice(0, 120) || "— без текста —"}
                    <span className="text-text-3 ml-2">· {row.category}</span>
                  </span>
                  {row.status === "draft" && <Badge>черновик</Badge>}
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={pending}
                    onClick={() =>
                      run(
                        () =>
                          upsertQuestionLinkAction({
                            questionId: row.id,
                            lessonId,
                            isKey: false,
                            inQuiz: true,
                          }),
                        "Привязано (in_quiz)",
                      )
                    }
                  >
                    Привязать
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
