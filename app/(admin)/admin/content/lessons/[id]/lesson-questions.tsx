"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Link2, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  flagsFromRole,
  QuestionRoleSelect,
  roleFromFlags,
  type QuestionLinkRole,
} from "@/components/features/question-role-select";
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
  const [attachRole, setAttachRole] = useState<QuestionLinkRole>("quiz");
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
        Роль одна: «ключевой» попадает в блок «Ключевые вопросы» (и в SRS с этапа 4), «в квизе» — в
        квиз урока.
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
              {/* Changelog этапа 3: роль одна — ключевой ИЛИ в квизе. */}
              <QuestionRoleSelect
                value={roleFromFlags(link.isKey, link.inQuiz)}
                onChange={(role) =>
                  run(() =>
                    upsertQuestionLinkAction({
                      questionId: link.questionId,
                      lessonId,
                      ...flagsFromRole(role),
                    }),
                  )
                }
              />
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
        <label className="text-text-2 flex items-center gap-2 text-[13px]">
          Привязывать как
          <QuestionRoleSelect
            value={attachRole}
            onChange={setAttachRole}
            ariaLabel="Роль для привязки из поиска"
          />
        </label>
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
                            ...flagsFromRole(attachRole),
                          }),
                        "Привязано",
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
