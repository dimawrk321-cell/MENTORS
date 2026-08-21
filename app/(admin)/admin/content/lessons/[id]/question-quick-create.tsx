"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  QuestionRoleSelect,
  type QuestionLinkRole,
} from "@/components/features/question-role-select";
import { QUESTION_DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/constants";
import { createLessonQuestionAction } from "@/lib/actions/questions-admin";

// Быстрое создание вопроса из редактора урока (заход C.6, блок 1). Полный
// редактор (/admin/questions/[id]) остаётся как есть — это быстрый путь, а не
// замена: из формы всегда можно уйти в него кнопкой «Создать и открыть
// полностью», и она сохраняет уже набранное.

type QuestionType = "open" | "single" | "multi" | "tf" | "short_text";

/** Откуда взялось умолчание категории — говорим прямо, а не подставляем молча. */
export type CategorySuggestionScope = "lesson" | "module" | "course";

const SCOPE_HINT: Record<CategorySuggestionScope, string> = {
  lesson: "по вопросам этого урока",
  module: "по вопросам этого модуля",
  course: "по вопросам этого курса",
};

const TYPES: QuestionType[] = ["open", "single", "multi", "tf", "short_text"];

const TF_OPTIONS = [
  { id: "true", text: "Верно", correct: true },
  { id: "false", text: "Неверно", correct: false },
];

let optionCounter = 0;
const newOptionId = () => `opt-${Date.now()}-${optionCounter++}`;

interface Option {
  id: string;
  text: string;
  correct: boolean;
}

interface FormState {
  type: QuestionType;
  categoryId: string;
  textMd: string;
  answerMd: string;
  explanationMd: string;
  options: Option[];
  acceptedText: string;
  difficulty: 1 | 2 | 3;
  role: QuestionLinkRole;
}

function initialState(defaultCategoryId: string): FormState {
  return {
    type: "open",
    categoryId: defaultCategoryId,
    textMd: "",
    answerMd: "",
    explanationMd: "",
    options: [
      { id: newOptionId(), text: "", correct: true },
      { id: newOptionId(), text: "", correct: false },
    ],
    acceptedText: "",
    // Ровно те же умолчания, что у полного редактора.
    difficulty: 2,
    role: "key",
  };
}

const textareaClass =
  "rounded-control border-border bg-surface-1 text-text-1 ease-app hover:border-border-strong w-full resize-y border p-3 font-mono text-[13px] leading-relaxed transition-colors duration-150";

export function QuestionQuickCreate({
  lessonId,
  categories,
  defaultCategoryId,
  defaultCategoryScope,
  onCreated,
}: {
  lessonId: string;
  categories: Array<{ id: string; label: string }>;
  /** Умолчание категории (заход C.6, 1.3); пусто — ментор выбирает сам. */
  defaultCategoryId: string;
  defaultCategoryScope: CategorySuggestionScope | null;
  /** Вызывается после успешного создания — секция обновляет список привязок. */
  onCreated: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(defaultCategoryId));
  const [pending, startTransition] = useTransition();

  const hasOptions = form.type === "single" || form.type === "multi" || form.type === "tf";
  const closed = form.type !== "open";

  function setType(type: QuestionType): void {
    setForm((prev) => ({
      ...prev,
      type,
      // «Верно / неверно» — фиксированная пара вариантов, как в полном редакторе.
      options: type === "tf" ? TF_OPTIONS.map((option) => ({ ...option })) : prev.options,
      // Роль по умолчанию следует за типом: открытый вопрос в квиз не идёт
      // вовсе (квиз собирается из закрытых), а закрытый в блоке «Ключевые
      // вопросы» раскрывал бы эталон, которого у него нет.
      role: type === "open" ? "key" : "quiz",
    }));
  }

  function setOption(id: string, patch: Partial<Option>): void {
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((option) => {
        if (option.id !== id) {
          // single/tf: ровно один правильный — новый выбор снимает прежний.
          if (patch.correct === true && prev.type !== "multi") return { ...option, correct: false };
          return option;
        }
        return { ...option, ...patch };
      }),
    }));
  }

  function payload() {
    return {
      lessonId,
      type: form.type,
      categoryId: form.categoryId,
      textMd: form.textMd,
      answerMd: form.type === "open" ? form.answerMd || null : null,
      explanationMd: closed ? form.explanationMd || null : null,
      options: hasOptions ? form.options : null,
      acceptedAnswers:
        form.type === "short_text"
          ? form.acceptedText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
          : null,
      difficulty: form.difficulty,
      role: form.role,
    };
  }

  function create(then: "stay" | "open"): void {
    startTransition(async () => {
      const result = await createLessonQuestionAction(payload());
      if (!result) return;
      if (!result.ok) {
        toast({ title: result.error.message, variant: "danger" });
        return;
      }
      if (then === "open") {
        // Уже набранное не теряется: вопрос создан и открывается целиком.
        router.push(`/admin/questions/${result.data.id}`);
        return;
      }
      toast({
        title: "Черновик создан и привязан к уроку",
        description: "Ученик увидит вопрос только после публикации.",
        variant: "success",
      });
      setForm(initialState(defaultCategoryId));
      onCreated();
      router.refresh();
    });
  }

  return (
    <div
      id="lesson-questions-create"
      className="border-border flex flex-col gap-3 border-t pt-4"
      aria-label="Создание вопроса"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-text-2 text-[13px]">Тип</span>
          <Select value={form.type} onValueChange={(value) => setType(value as QuestionType)}>
            <SelectTrigger aria-label="Тип вопроса">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {QUESTION_TYPE_LABEL[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-text-2 text-[13px]">Категория</span>
          <Select
            value={form.categoryId || "none"}
            onValueChange={(value) =>
              setForm({ ...form, categoryId: value === "none" ? "" : value })
            }
          >
            <SelectTrigger aria-label="Категория">
              <SelectValue placeholder="Выбери категорию" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Выбери категорию</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* 1.3: откуда взялось умолчание — сказано на экране, а не только в коде. */}
          <p className="text-text-3 text-[12px]">
            {defaultCategoryScope && form.categoryId === defaultCategoryId
              ? `Подставлена ${SCOPE_HINT[defaultCategoryScope]} — поменяй, если тема другая.`
              : "Категория решает, кому вопрос будет виден: доступ к банку идёт по курсу этой категории."}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-q-text" className="text-text-2 text-[13px]">
          Текст вопроса (markdown + KaTeX)
        </label>
        <textarea
          id="new-q-text"
          value={form.textMd}
          onChange={(event) => setForm({ ...form, textMd: event.target.value })}
          rows={3}
          spellCheck={false}
          className={textareaClass}
        />
      </div>

      {form.type === "open" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-q-answer" className="text-text-2 text-[13px]">
            Эталонный ответ
          </label>
          <textarea
            id="new-q-answer"
            value={form.answerMd}
            onChange={(event) => setForm({ ...form, answerMd: event.target.value })}
            rows={5}
            spellCheck={false}
            className={textareaClass}
          />
          <p className="text-text-3 text-[12px]">
            Без эталона вопрос не покажется ученику даже после публикации — это обратная сторона
            карточки.
          </p>
        </div>
      )}

      {hasOptions && (
        <div className="flex flex-col gap-1.5">
          <span className="text-text-2 text-[13px]">
            Варианты ({form.type === "multi" ? "несколько правильных" : "один правильный"}) — отметь
            правильный
          </span>
          <div className="flex flex-col gap-2">
            {form.options.map((option) => (
              <div key={option.id} className="flex items-center gap-2">
                <Checkbox
                  checked={option.correct}
                  onCheckedChange={(checked) => setOption(option.id, { correct: checked === true })}
                  aria-label="Правильный вариант"
                />
                <Input
                  value={option.text}
                  onChange={(event) => setOption(option.id, { text: event.target.value })}
                  aria-label="Текст варианта"
                  placeholder="Текст варианта"
                  disabled={form.type === "tf"}
                />
                {form.type !== "tf" && (
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
          {form.type !== "tf" && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    options: [...prev.options, { id: newOptionId(), text: "", correct: false }],
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

      {form.type === "short_text" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-q-accepted" className="text-text-2 text-[13px]">
            Принимаемые ответы (по одному на строку; сравнение без регистра, ё=е)
          </label>
          <textarea
            id="new-q-accepted"
            value={form.acceptedText}
            onChange={(event) => setForm({ ...form, acceptedText: event.target.value })}
            rows={3}
            spellCheck={false}
            className={textareaClass}
          />
        </div>
      )}

      {closed && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-q-explanation" className="text-text-2 text-[13px]">
            Разбор (показывается после ответа в квизе и в сданном тесте)
          </label>
          <textarea
            id="new-q-explanation"
            value={form.explanationMd}
            onChange={(event) => setForm({ ...form, explanationMd: event.target.value })}
            rows={3}
            spellCheck={false}
            className={textareaClass}
          />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-text-2 flex items-center gap-2 text-[13px]">
          Роль в уроке
          <QuestionRoleSelect
            value={form.role}
            onChange={(role) => setForm({ ...form, role })}
            ariaLabel="Роль нового вопроса в уроке"
          />
        </label>
        <label className="text-text-2 flex items-center gap-2 text-[13px]">
          Сложность
          <Select
            value={String(form.difficulty)}
            onValueChange={(value) => setForm({ ...form, difficulty: Number(value) as 1 | 2 | 3 })}
          >
            <SelectTrigger className="h-8 w-36 text-[13px]" aria-label="Сложность">
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
        </label>
      </div>

      {/* 1.2: черновик — это решение, а не умолчание, и ментор об этом читает
          до нажатия, а не догадывается по бейджу после. */}
      <p className="text-text-3 text-[13px]">
        Вопрос создаётся <span className="text-text-2">черновиком</span> и сразу привязывается к
        уроку. Ученик увидит его только после публикации — она делается отдельной кнопкой в списке
        выше.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="gradient"
          size="sm"
          loading={pending}
          disabled={!form.textMd.trim() || !form.categoryId}
          onClick={() => create("stay")}
        >
          Создать черновик
        </Button>
        {/* 1.4: выход в полный редактор — с сохранением набранного. */}
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          disabled={!form.textMd.trim() || !form.categoryId}
          onClick={() => create("open")}
        >
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
          Создать и открыть полностью
        </Button>
        <Link href="/admin/questions" className="text-text-3 hover:text-text-1 text-[12px]">
          Весь банк вопросов
        </Link>
      </div>
    </div>
  );
}
