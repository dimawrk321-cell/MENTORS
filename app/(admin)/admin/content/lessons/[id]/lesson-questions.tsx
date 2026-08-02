"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckSquare, Link2, Plus, Search, Square, Trash2 } from "lucide-react";
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
  bulkQuestionLinkRoleAction,
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  // Bulk role marking (walk 13.6, block 3v2). The category pass links whole
  // categories at once, and re-picking a role on twelve rows one select at a
  // time is not a workflow — «ключевой» in particular is an editorial decision
  // made over a batch.
  const toggleSelected = (questionId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });

  // Что реально доедет до ученика: черновики отбрасывает выборка урока
  // (getKeyQuestionsForLesson / getQuizQuestionsForLesson), и без этой строки
  // пропажа блока выглядит как баг платформы, а не как неопубликованный вопрос.
  const published = links.filter((link) => link.status === "published");
  const visibleKey = published.filter((link) => link.isKey).length;
  const visibleQuiz = published.filter((link) => link.inQuiz).length;
  const draftLinks = links.length - published.length;

  const allSelected = links.length > 0 && selected.size === links.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(links.map((link) => link.questionId)));

  function bulkRole(role: QuestionLinkRole, success: string): void {
    const questionIds = [...selected];
    run(() => bulkQuestionLinkRoleAction({ lessonId, questionIds, role }), success);
    setSelected(new Set());
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
      <p className="text-text-3 mb-2 text-[13px]">
        Роль одна: «ключевой» попадает в блок «Ключевые вопросы» (и в SRS с этапа 4), «в квизе» — в
        квиз урока.
      </p>

      {/* Находка владельца: счётчик привязок показывал 2, а блока «Ключевые
          вопросы» у ученика не было — оба вопроса оказались ЧЕРНОВИКАМИ, и
          выборка их молча отбросила. Счётчик считает привязки, а не то, что
          доедет до ученика, поэтому итог проговаривается явно. */}
      {links.length > 0 && (
        <p className="text-text-2 mb-3 text-[13px]">
          Ученик увидит: <span className="text-text-1 tabular-nums">{visibleKey}</span> ключевых ·{" "}
          <span className="text-text-1 tabular-nums">{visibleQuiz}</span> в квизе
        </p>
      )}
      {draftLinks > 0 && (
        <p className="rounded-control border-warning/35 bg-warning/6 text-text-2 mb-3 flex items-start gap-2 border px-3 py-2 text-[13px]">
          <AlertTriangle
            size={15}
            strokeWidth={1.75}
            className="text-warning mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            Привязано черновиков: <span className="tabular-nums">{draftLinks}</span> — ученик их не
            увидит. Опубликуй вопрос в банке, иначе привязка не работает.
          </span>
        </p>
      )}

      {links.length === 0 ? (
        <p className="text-text-3 mb-4 text-[13px]">
          Пока ничего не привязано — нажми «Добавить вопрос».
        </p>
      ) : (
        <>
          {/* Bulk bar (walk 13.6, block 3v2). Appears only with a selection, so
              the section looks unchanged for a lesson with three questions. */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className="text-text-2 hover:text-text-1 ease-app inline-flex items-center gap-1.5 text-[13px] transition-colors duration-150"
            >
              {allSelected ? (
                <CheckSquare size={15} strokeWidth={1.75} className="text-accent" />
              ) : (
                <Square size={15} strokeWidth={1.75} />
              )}
              {allSelected ? "Снять выделение" : "Выбрать все"}
            </button>
            {selected.size > 0 && (
              <>
                <span className="text-text-3 text-[13px] tabular-nums">
                  выбрано {selected.size}
                </span>
                <span className="bg-border mx-1 h-4 w-px" aria-hidden="true" />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => bulkRole("key", `Отмечено ключевыми: ${selected.size}`)}
                >
                  Сделать ключевыми
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => bulkRole("quiz", `В квиз: ${selected.size}`)}
                >
                  В квиз
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => bulkRole("plain", `Снята роль: ${selected.size}`)}
                >
                  Снять роль
                </Button>
              </>
            )}
          </div>
          {/* A whole linked category can be 60 rows — cap the height so the rest
              of the editor stays reachable. */}
          <ul className="mb-4 flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
            {links.map((link) => (
              <li key={link.questionId} className="flex flex-wrap items-center gap-3 text-[13px]">
                <input
                  type="checkbox"
                  checked={selected.has(link.questionId)}
                  onChange={() => toggleSelected(link.questionId)}
                  aria-label={`Выбрать вопрос: ${link.teaser}`}
                  className="accent-accent size-4 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">
                  {link.teaser}
                  <span className="text-text-3 ml-2">· {link.category}</span>
                </span>
                {link.status === "draft" && (
                  <Badge variant="warning" title="Черновик — ученик этот вопрос не увидит">
                    черновик
                  </Badge>
                )}
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
        </>
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
                  {row.status === "draft" && (
                    <Badge variant="warning" title="Черновик — ученик этот вопрос не увидит">
                      черновик
                    </Badge>
                  )}
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
