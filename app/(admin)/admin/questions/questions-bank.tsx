"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FolderPlus, MessageCircleQuestion, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
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
import { Switch } from "@/components/ui/switch";
import {
  flagsFromRole,
  QuestionRoleSelect,
  type QuestionLinkRole,
} from "@/components/features/question-role-select";
import { QUESTION_DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/constants";
import {
  bulkQuestionsAction,
  createCategoryAction,
  createQuestionAction,
} from "@/lib/actions/questions-admin";

export interface BankCategory {
  id: string;
  title: string;
  colorIndex: number;
  children: Array<{ id: string; title: string }>;
}

export interface BankRow {
  id: string;
  teaser: string;
  type: string;
  difficulty: number;
  status: "draft" | "published";
  needsLatex: boolean;
  categoryTitle: string;
  links: number;
}

interface QuestionsBankProps {
  categories: BankCategory[];
  lessons: Array<{ id: string; label: string }>;
  rows: BankRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: { q: string; category: string; type: string; status: string; latex: boolean };
}

const TYPE_OPTIONS = ["open", "single", "multi", "tf", "short_text"] as const;

export function QuestionsBank({
  categories,
  lessons,
  rows,
  total,
  page,
  pageSize,
  filters,
}: QuestionsBankProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const [newQuestionOpen, setNewQuestionOpen] = useState(false);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [linkLessonId, setLinkLessonId] = useState("");
  const [linkRole, setLinkRole] = useState<QuestionLinkRole>("quiz");
  const [newQuestion, setNewQuestion] = useState({ type: "open", categoryId: "" });
  const [newCategory, setNewCategory] = useState({ title: "", parentId: "" });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function applyFilters(patch: Partial<typeof filters & { page: string }>): void {
    const params = new URLSearchParams();
    const next = { ...filters, ...patch };
    if (next.q) params.set("q", next.q);
    if (next.category) params.set("category", next.category);
    if (next.type) params.set("type", next.type);
    if (next.status) params.set("status", next.status);
    if (next.latex) params.set("latex", "1");
    if ("page" in patch && patch.page) params.set("page", patch.page);
    router.push(`/admin/questions${params.size ? `?${params}` : ""}`);
  }

  function toggleRow(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk(
    op:
      | { kind: "category"; categoryId: string }
      | { kind: "publish" }
      | { kind: "link"; lessonId: string; isKey: boolean; inQuiz: boolean },
  ): void {
    startTransition(async () => {
      const result = await bulkQuestionsAction({ questionIds: [...selected], op });
      if (!result) return;
      if (result.ok) {
        toast({ title: result.data.message, variant: "success" });
        setSelected(new Set());
        setLinkDialogOpen(false);
        router.refresh();
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  const categoryOptions = categories.flatMap((root) => [
    { id: root.id, label: root.title },
    ...root.children.map((child) => ({ id: child.id, label: `— ${child.title}` })),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold">Вопросы</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setNewCategoryOpen(true)}>
            <FolderPlus size={15} strokeWidth={1.75} aria-hidden="true" />
            Категория
          </Button>
          <Button onClick={() => setNewQuestionOpen(true)}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            Вопрос
          </Button>
        </div>
      </div>

      {/* Фильтры (spec 8.5: категория, тип, статус, needs_latex) */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters({ q: new FormData(event.currentTarget).get("q") as string });
          }}
        >
          <Input name="q" defaultValue={filters.q} placeholder="Поиск по тексту" className="w-56" />
          <Button type="submit" variant="secondary" size="md">
            Найти
          </Button>
        </form>
        <Select
          value={filters.category || "all"}
          onValueChange={(value) => applyFilters({ category: value === "all" ? "" : value })}
        >
          <SelectTrigger className="w-52" aria-label="Категория">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все категории</SelectItem>
            {categoryOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.type || "all"}
          onValueChange={(value) => applyFilters({ type: value === "all" ? "" : value })}
        >
          <SelectTrigger className="w-44" aria-label="Тип">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {TYPE_OPTIONS.map((type) => (
              <SelectItem key={type} value={type}>
                {QUESTION_TYPE_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.status || "all"}
          onValueChange={(value) => applyFilters({ status: value === "all" ? "" : value })}
        >
          <SelectTrigger className="w-40" aria-label="Статус">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любой статус</SelectItem>
            <SelectItem value="draft">Черновики</SelectItem>
            <SelectItem value="published">Опубликованные</SelectItem>
          </SelectContent>
        </Select>
        <label className="text-text-2 flex items-center gap-2 text-[13px]">
          <Switch checked={filters.latex} onCheckedChange={(latex) => applyFilters({ latex })} />
          needs_latex
        </label>
      </div>

      {/* Панель массовых операций */}
      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-text-2 text-[13px]">Выбрано: {selected.size}</span>
          <div className="flex items-center gap-2">
            <Select value={bulkCategoryId || "none"} onValueChange={setBulkCategoryId}>
              <SelectTrigger className="w-48" aria-label="Новая категория">
                <SelectValue placeholder="Категория…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Категория…</SelectItem>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              size="sm"
              loading={pending}
              disabled={!bulkCategoryId || bulkCategoryId === "none"}
              onClick={() => runBulk({ kind: "category", categoryId: bulkCategoryId })}
            >
              Сменить категорию
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() => setLinkDialogOpen(true)}
          >
            Привязать к уроку
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() => runBulk({ kind: "publish" })}
          >
            Опубликовать
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Снять выбор
          </Button>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageCircleQuestion}
            title="Вопросов не нашлось"
            description="Создай вопрос или измени фильтры."
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[14px]">
              <thead>
                <tr className="border-border text-text-3 border-b text-left text-[12px] tracking-wide uppercase">
                  <th className="w-10 px-4 py-3" aria-label="Выбор" />
                  <th className="px-3 py-3 font-medium">Вопрос</th>
                  <th className="px-3 py-3 font-medium">Категория</th>
                  <th className="px-3 py-3 font-medium">Тип</th>
                  <th className="px-3 py-3 font-medium">Сложность</th>
                  <th className="px-3 py-3 font-medium">Статус</th>
                  <th className="px-3 py-3 font-medium">Уроки</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-border ease-app hover:bg-surface-2 border-b transition-colors duration-150 last:border-b-0"
                  >
                    <td className="px-4 py-2.5">
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleRow(row.id)}
                        aria-label="Выбрать вопрос"
                      />
                    </td>
                    <td className="max-w-[360px] px-3 py-2.5">
                      <Link
                        href={`/admin/questions/${row.id}`}
                        className="text-text-1 hover:text-accent block truncate font-medium"
                      >
                        {row.teaser}
                      </Link>
                      {row.needsLatex && (
                        <Badge variant="warning" className="mt-1">
                          needs_latex
                        </Badge>
                      )}
                    </td>
                    <td className="text-text-2 px-3 py-2.5">{row.categoryTitle}</td>
                    <td className="text-text-2 px-3 py-2.5">{QUESTION_TYPE_LABEL[row.type]}</td>
                    <td className="text-text-2 px-3 py-2.5">
                      {QUESTION_DIFFICULTY_LABEL[row.difficulty]}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.status === "published" ? (
                        <Badge variant="success">опубликован</Badge>
                      ) : (
                        <Badge>черновик</Badge>
                      )}
                    </td>
                    <td className="text-text-2 px-3 py-2.5 tabular-nums">{row.links}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="text-text-2 flex items-center justify-center gap-3 text-[13px]">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => applyFilters({ page: String(page - 1) })}
          >
            ← Назад
          </Button>
          <span className="text-text-3">
            {page} из {totalPages} · всего {total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => applyFilters({ page: String(page + 1) })}
          >
            Дальше →
          </Button>
        </div>
      )}

      {/* Новый вопрос */}
      <Dialog open={newQuestionOpen} onOpenChange={setNewQuestionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый вопрос</DialogTitle>
            <DialogDescription>Черновик откроется в редакторе.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-text-2 text-[13px]">Тип</span>
              <Select
                value={newQuestion.type}
                onValueChange={(type) => setNewQuestion({ ...newQuestion, type })}
              >
                <SelectTrigger aria-label="Тип вопроса">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((type) => (
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
                value={newQuestion.categoryId || "none"}
                onValueChange={(categoryId) =>
                  setNewQuestion({
                    ...newQuestion,
                    categoryId: categoryId === "none" ? "" : categoryId,
                  })
                }
              >
                <SelectTrigger aria-label="Категория">
                  <SelectValue placeholder="Выбери категорию" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Выбери категорию</SelectItem>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewQuestionOpen(false)}>
              Отмена
            </Button>
            <Button
              loading={pending}
              disabled={!newQuestion.categoryId}
              onClick={() =>
                startTransition(async () => {
                  const result = await createQuestionAction(newQuestion);
                  if (!result) return;
                  if (result.ok) {
                    setNewQuestionOpen(false);
                    router.push(`/admin/questions/${result.data.id}`);
                  } else {
                    toast({ title: result.error.message, variant: "danger" });
                  }
                })
              }
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Новая категория (inline — spec 8.5) */}
      <Dialog open={newCategoryOpen} onOpenChange={setNewCategoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая категория</DialogTitle>
            <DialogDescription>
              Корневые категории получают цвет по порядку; подкатегории наследуют цвет родителя.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cat-title" className="text-text-2 text-[13px]">
                Название
              </label>
              <Input
                id="cat-title"
                value={newCategory.title}
                onChange={(event) => setNewCategory({ ...newCategory, title: event.target.value })}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-text-2 text-[13px]">Родитель (для подкатегории)</span>
              <Select
                value={newCategory.parentId || "root"}
                onValueChange={(parentId) =>
                  setNewCategory({ ...newCategory, parentId: parentId === "root" ? "" : parentId })
                }
              >
                <SelectTrigger aria-label="Родительская категория">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">— корневая —</SelectItem>
                  {categories.map((root) => (
                    <SelectItem key={root.id} value={root.id}>
                      {root.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewCategoryOpen(false)}>
              Отмена
            </Button>
            <Button
              loading={pending}
              disabled={!newCategory.title.trim()}
              onClick={() =>
                startTransition(async () => {
                  const result = await createCategoryAction({
                    title: newCategory.title.trim(),
                    parentId: newCategory.parentId || null,
                  });
                  if (!result) return;
                  if (result.ok) {
                    toast({ title: "Категория создана", variant: "success" });
                    setNewCategoryOpen(false);
                    setNewCategory({ title: "", parentId: "" });
                    router.refresh();
                  } else {
                    toast({ title: result.error.message, variant: "danger" });
                  }
                })
              }
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Массовая привязка к уроку */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Привязать к уроку</DialogTitle>
            <DialogDescription>Выбрано вопросов: {selected.size}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-text-2 text-[13px]">Урок</span>
              <Select
                value={linkLessonId || "none"}
                onValueChange={(value) => setLinkLessonId(value === "none" ? "" : value)}
              >
                <SelectTrigger aria-label="Урок">
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
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-text-2 text-[13px]">Роль в уроке</span>
              {/* Changelog этапа 3: роли взаимоисключающие. */}
              <QuestionRoleSelect value={linkRole} onChange={setLinkRole} className="h-9 w-full" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setLinkDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              loading={pending}
              disabled={!linkLessonId}
              onClick={() =>
                runBulk({ kind: "link", lessonId: linkLessonId, ...flagsFromRole(linkRole) })
              }
            >
              Привязать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
