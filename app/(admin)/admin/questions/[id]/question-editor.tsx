"use client";

import { BackButton } from "@/components/ui/back-button";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { QUESTION_DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/constants";
import type { ActionResult } from "@/lib/auth/action-helpers";
import {
  deleteQuestionAction,
  removeQuestionLinkAction,
  renderQuestionPreviewAction,
  setQuestionStatusAction,
  updateQuestionAction,
  upsertQuestionLinkAction,
} from "@/lib/actions/questions-admin";

interface EditorQuestion {
  id: string;
  type: "open" | "single" | "multi" | "tf" | "short_text";
  status: "draft" | "published";
  categoryId: string;
  textMd: string;
  answerMd: string;
  explanationMd: string;
  options: Array<{ id: string; text: string; correct: boolean }>;
  acceptedAnswers: string[];
  difficulty: 1 | 2 | 3;
  needsLatex: boolean;
  source: "import" | "manual";
}

interface QuestionLinkRow {
  lessonId: string;
  label: string;
  isKey: boolean;
  inQuiz: boolean;
}

interface QuestionEditorProps {
  question: EditorQuestion;
  categories: Array<{ id: string; label: string }>;
  lessons: Array<{ id: string; label: string }>;
  links: QuestionLinkRow[];
}

let optionCounter = 0;

export function QuestionEditor({ question, categories, lessons, links }: QuestionEditorProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    categoryId: question.categoryId,
    textMd: question.textMd,
    answerMd: question.answerMd,
    explanationMd: question.explanationMd,
    options: question.options,
    acceptedText: question.acceptedAnswers.join("\n"),
    difficulty: question.difficulty,
    needsLatex: question.needsLatex,
  });
  const [previewHtml, setPreviewHtml] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newLink, setNewLink] = useState<{ lessonId: string; role: QuestionLinkRole }>({
    lessonId: "",
    role: "quiz",
  });
  const [pending, startTransition] = useTransition();
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closed = question.type !== "open";
  const hasOptions = ["single", "multi", "tf"].includes(question.type);

  // KaTeX/markdown предпросмотр (spec 8.5) — дебаунс через server action.
  useEffect(() => {
    const combined = [form.textMd, question.type === "open" ? form.answerMd : form.explanationMd]
      .filter((part) => part.trim())
      .join("\n\n---\n\n");
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      void renderQuestionPreviewAction(combined).then((result) => {
        if (result?.ok) setPreviewHtml(result.data.html);
      });
    }, 700);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [form.textMd, form.answerMd, form.explanationMd, question.type]);

  function run(action: () => Promise<ActionResult<unknown> | void>, success?: string): void {
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

  function save(): void {
    run(
      () =>
        updateQuestionAction({
          questionId: question.id,
          categoryId: form.categoryId,
          textMd: form.textMd,
          answerMd: question.type === "open" ? form.answerMd || null : null,
          explanationMd: closed ? form.explanationMd || null : null,
          options: hasOptions ? form.options : null,
          acceptedAnswers:
            question.type === "short_text"
              ? form.acceptedText
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
              : null,
          difficulty: form.difficulty,
          needsLatex: form.needsLatex,
        }),
      "Вопрос сохранён",
    );
  }

  function setOption(id: string, patch: Partial<{ text: string; correct: boolean }>): void {
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((option) => {
        if (option.id !== id) {
          // single/tf: ровно один правильный — выбор нового снимает старый.
          if (patch.correct === true && question.type !== "multi") {
            return { ...option, correct: false };
          }
          return option;
        }
        return { ...option, ...patch };
      }),
    }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <BackButton href="/admin/questions" label="Вопросы" className="w-auto" />
        <Badge>{QUESTION_TYPE_LABEL[question.type]}</Badge>
        <Badge>{question.source === "import" ? "импорт" : "создан вручную"}</Badge>
        {question.status === "published" ? (
          <Badge variant="success">опубликован</Badge>
        ) : (
          <Badge>черновик</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" loading={pending} onClick={save}>
            Сохранить
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() =>
              run(
                () =>
                  setQuestionStatusAction(
                    question.id,
                    question.status === "published" ? "draft" : "published",
                  ),
                question.status === "published" ? "Снят с публикации" : "Опубликован",
              )
            }
          >
            {question.status === "published" ? "В черновик" : "Опубликовать"}
          </Button>
          {question.status === "draft" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
              Удалить
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Левая колонка — поля */}
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-text-2 text-[13px]">Категория</span>
              <Select
                value={form.categoryId}
                onValueChange={(categoryId) => setForm({ ...form, categoryId })}
              >
                <SelectTrigger aria-label="Категория">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-text-2 text-[13px]">Сложность</span>
                <Select
                  value={String(form.difficulty)}
                  onValueChange={(value) =>
                    setForm({ ...form, difficulty: Number(value) as 1 | 2 | 3 })
                  }
                >
                  <SelectTrigger aria-label="Сложность">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3].map((level) => (
                      <SelectItem key={level} value={String(level)}>
                        {QUESTION_DIFFICULTY_LABEL[level]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="text-text-2 flex h-9 items-center gap-2 text-[13px]">
                <Switch
                  checked={form.needsLatex}
                  onCheckedChange={(needsLatex) => setForm({ ...form, needsLatex })}
                />
                needs_latex
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="q-text" className="text-text-2 text-[13px]">
              Текст вопроса (markdown + KaTeX)
            </label>
            <textarea
              id="q-text"
              value={form.textMd}
              onChange={(event) => setForm({ ...form, textMd: event.target.value })}
              rows={5}
              spellCheck={false}
              className="rounded-control border-border bg-surface-1 text-text-1 ease-app hover:border-border-strong w-full resize-y border p-3 font-mono text-[13px] leading-relaxed transition-colors duration-150"
            />
          </div>

          {question.type === "open" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="q-answer" className="text-text-2 text-[13px]">
                Эталонный ответ
              </label>
              <textarea
                id="q-answer"
                value={form.answerMd}
                onChange={(event) => setForm({ ...form, answerMd: event.target.value })}
                rows={8}
                spellCheck={false}
                className="rounded-control border-border bg-surface-1 text-text-1 ease-app hover:border-border-strong w-full resize-y border p-3 font-mono text-[13px] leading-relaxed transition-colors duration-150"
              />
            </div>
          )}

          {hasOptions && (
            <div className="flex flex-col gap-1.5">
              <span className="text-text-2 text-[13px]">
                Варианты ({question.type === "multi" ? "несколько правильных" : "один правильный"})
              </span>
              <div className="flex flex-col gap-2">
                {form.options.map((option) => (
                  <div key={option.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={option.correct}
                      onCheckedChange={(checked) =>
                        setOption(option.id, { correct: checked === true })
                      }
                      aria-label="Правильный вариант"
                    />
                    <Input
                      value={option.text}
                      onChange={(event) => setOption(option.id, { text: event.target.value })}
                      placeholder="Текст варианта"
                      disabled={question.type === "tf"}
                    />
                    {question.type !== "tf" && (
                      <button
                        type="button"
                        aria-label="Удалить вариант"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            options: prev.options.filter((item) => item.id !== option.id),
                          }))
                        }
                        className="rounded-control text-text-3 hover:text-danger flex size-8 shrink-0 items-center justify-center"
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {question.type !== "tf" && (
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        options: [
                          ...prev.options,
                          { id: `opt-${Date.now()}-${optionCounter++}`, text: "", correct: false },
                        ],
                      }))
                    }
                  >
                    <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                    Вариант
                  </Button>
                </div>
              )}
            </div>
          )}

          {question.type === "short_text" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="q-accepted" className="text-text-2 text-[13px]">
                Принимаемые ответы (по одному на строку; сравнение без регистра, ё=е)
              </label>
              <textarea
                id="q-accepted"
                value={form.acceptedText}
                onChange={(event) => setForm({ ...form, acceptedText: event.target.value })}
                rows={4}
                spellCheck={false}
                className="rounded-control border-border bg-surface-1 text-text-1 ease-app hover:border-border-strong w-full resize-y border p-3 font-mono text-[13px] leading-relaxed transition-colors duration-150"
              />
            </div>
          )}

          {closed && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="q-explanation" className="text-text-2 text-[13px]">
                Разбор (после ответа в квизе и в успешном тесте)
              </label>
              <textarea
                id="q-explanation"
                value={form.explanationMd}
                onChange={(event) => setForm({ ...form, explanationMd: event.target.value })}
                rows={5}
                spellCheck={false}
                className="rounded-control border-border bg-surface-1 text-text-1 ease-app hover:border-border-strong w-full resize-y border p-3 font-mono text-[13px] leading-relaxed transition-colors duration-150"
              />
            </div>
          )}
        </div>

        {/* Правая колонка — предпросмотр */}
        <div className="flex flex-col gap-1.5">
          <span className="text-text-2 text-[13px]">Предпросмотр</span>
          <div
            className="lesson-prose rounded-card border-border bg-surface-1 min-h-[200px] border p-4 text-[15px]"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </div>

      {/* Привязки к урокам (spec 7.4/8.5) */}
      <section className="rounded-card border-border bg-surface-1 border p-4">
        <h2 className="mb-3 text-[16px] font-semibold">Привязка к урокам</h2>
        {links.length === 0 ? (
          <p className="text-text-3 mb-3 text-[13px]">Вопрос пока не привязан к урокам.</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-2">
            {links.map((link) => (
              <li key={link.lessonId} className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{link.label}</span>
                {/* Changelog этапа 3: роль одна — ключевой ИЛИ в квизе. */}
                <QuestionRoleSelect
                  value={roleFromFlags(link.isKey, link.inQuiz)}
                  onChange={(role) =>
                    run(() =>
                      upsertQuestionLinkAction({
                        questionId: question.id,
                        lessonId: link.lessonId,
                        ...flagsFromRole(role),
                      }),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label="Отвязать от урока"
                  onClick={() =>
                    run(
                      () =>
                        removeQuestionLinkAction({
                          questionId: question.id,
                          lessonId: link.lessonId,
                        }),
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
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={newLink.lessonId || "none"}
            onValueChange={(value) =>
              setNewLink({ ...newLink, lessonId: value === "none" ? "" : value })
            }
          >
            <SelectTrigger className="w-72" aria-label="Урок для привязки">
              <SelectValue placeholder="Выбери урок" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Выбери урок</SelectItem>
              {lessons.map((lesson) => (
                <SelectItem key={lesson.id} value={lesson.id}>
                  {lesson.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <QuestionRoleSelect
            value={newLink.role}
            onChange={(role) => setNewLink({ ...newLink, role })}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            disabled={!newLink.lessonId}
            onClick={() =>
              run(
                () =>
                  upsertQuestionLinkAction({
                    questionId: question.id,
                    lessonId: newLink.lessonId,
                    ...flagsFromRole(newLink.role),
                  }),
                "Привязано",
              )
            }
          >
            Привязать
          </Button>
        </div>
      </section>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить вопрос?</DialogTitle>
            <DialogDescription>Черновик будет удалён. Действие необратимо.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteQuestionAction(question.id);
                  if (!result) return;
                  if (result.ok) {
                    router.push("/admin/questions");
                  } else {
                    toast({ title: result.error.message, variant: "danger" });
                  }
                })
              }
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
