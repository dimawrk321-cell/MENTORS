"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Link2, Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  categories,
}: {
  lessonId: string;
  links: LessonQuestionLinkRow[];
  /** Корневые категории для фильтра в панели добавления (changelog 13.6). */
  categories: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // Fresh lesson with nothing linked → the panel starts open, so the way in is
  // visible without a click (changelog 13.6).
  const [adding, setAdding] = useState(links.length === 0);
  const [results, setResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [attachRole, setAttachRole] = useState<QuestionLinkRole>("quiz");
  const [pending, startTransition] = useTransition();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const linkedIds = new Set(links.map((link) => link.questionId));
  // The server search does not exclude already-linked questions, so filter once
  // and gate BOTH the list and the fallback on the filtered set — otherwise the
  // panel renders an empty <ul> and suppresses the explanation.
  const available = results.filter((row) => !linkedIds.has(row.id));

  useEffect(() => {
    // A category alone is a valid filter — browsing without typing is the point.
    if (!query.trim() && !categoryId) {
      setResults([]);
      return;
    }
    setSearching(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void searchQuestionsAction(query.trim(), categoryId || undefined).then((result) => {
        setSearching(false);
        if (result?.ok) setResults(result.data);
      });
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, categoryId]);

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
    <section
      id="lesson-questions"
      className="rounded-card border-border bg-surface-1 shadow-card scroll-mt-4 border p-5"
    >
      {/* Changelog 13.6: the section must be impossible to miss — own heading with
          a live counter and an explicit «+ Добавить вопрос» button (a bare search
          field read as decoration and got overlooked). */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.01em]">
          <Link2 size={18} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
          Вопросы урока
          <span className="rounded-pill bg-accent/12 text-accent px-2 py-0.5 text-[12px] font-medium tabular-nums">
            {links.length}
          </span>
        </h2>
        <Button
          variant={links.length === 0 ? "gradient" : "secondary"}
          size="sm"
          onClick={() => setAdding((prev) => !prev)}
          aria-expanded={adding}
          aria-controls="lesson-questions-add"
        >
          <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
          {adding ? "Закрыть" : "Добавить вопрос"}
        </Button>
      </div>
      <p className="text-text-3 mb-3 text-[13px]">
        Роль одна: «ключевой» попадает в блок «Ключевые вопросы» (и в SRS с этапа 4), «в квизе» — в
        квиз урока.
      </p>

      {links.length === 0 ? (
        <p className="text-text-3 mb-4 text-[13px]">
          Пока ничего не привязано — нажми «Добавить вопрос».
        </p>
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

      {adding && (
        <div id="lesson-questions-add" className="border-border flex flex-col gap-2 border-t pt-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
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
                autoFocus
              />
            </div>
            {/* Category filter (changelog 13.6): picking a category alone lists
                that category's bank, so the mentor can browse without typing. */}
            <Select
              value={categoryId || "all"}
              onValueChange={(value) => setCategoryId(value === "all" ? "" : value)}
            >
              <SelectTrigger className="w-52" aria-label="Категория">
                <SelectValue placeholder="Все категории" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все категории</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          {available.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {available.map((row) => (
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
          {!searching && available.length === 0 && (query.trim() || categoryId) && (
            <p className="text-text-3 text-[12px]">
              {results.length === 0
                ? "Ничего не нашлось — измени запрос или категорию."
                : "Все найденные вопросы уже привязаны к уроку."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
