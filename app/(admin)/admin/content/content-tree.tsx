"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BookCheck,
  ClipboardCheck,
  Eye,
  EyeOff,
  FilePlus2,
  FolderPlus,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import type { ActionResult } from "@/lib/auth/action-helpers";
import {
  createCourseAction,
  createLessonAction,
  createModuleAction,
  deleteCourseAction,
  deleteLessonAction,
  deleteModuleAction,
  publishLessonsAction,
  renameModuleAction,
  reorderContentAction,
  setCourseStatusAction,
  setModuleStatusAction,
  updateCourseAction,
} from "@/lib/actions/content-admin";
import { upsertModuleTestAction } from "@/lib/actions/questions-admin";
import { pluralRu } from "@/lib/utils/dates";

export interface TreeLesson {
  id: string;
  title: string;
  status: "draft" | "published";
  isOptional: boolean;
  readingMinutes: number;
}

export interface TreeModuleTest {
  poolSize: number;
  threshold: number;
  cooldownMinutes: number;
  enabled: boolean;
}

export interface TreeModule {
  id: string;
  title: string;
  status: "draft" | "published";
  test: TreeModuleTest | null;
  lessons: TreeLesson[];
}

export interface TreeCourse {
  id: string;
  title: string;
  slug: string;
  description: string;
  gating: "strict" | "recommended" | "free";
  status: "draft" | "published";
  modules: TreeModule[];
}

const GATING_OPTIONS = [
  { value: "strict", label: "Строгий порядок" },
  { value: "recommended", label: "Рекомендованный порядок" },
  { value: "free", label: "Свободный порядок" },
] as const;

function StatusBadge({ status }: { status: "draft" | "published" }) {
  // Draft = warning (spec 12.1/C10): distinct from the neutral «необязательный» tag.
  return status === "published" ? (
    <Badge variant="success">опубликован</Badge>
  ) : (
    <Badge variant="warning">черновик</Badge>
  );
}

/** Leading status dot for lesson rows (spec 12.1/C10) — scannable at a glance. */
function StatusDot({ status }: { status: "draft" | "published" }) {
  return (
    <span
      aria-hidden="true"
      title={status === "published" ? "Опубликован" : "Черновик"}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "published" ? "bg-success" : "bg-warning",
      )}
    />
  );
}

// --- Generic sortable list (vertical drag within siblings) ---

function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (orderedIds: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-70", className)}
    >
      <button
        type="button"
        aria-label="Перетащить для изменения порядка"
        {...attributes}
        {...listeners}
        className="text-text-3 hover:text-text-1 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-[6px] active:cursor-grabbing"
      >
        <GripVertical size={14} strokeWidth={1.75} />
      </button>
      {children}
    </div>
  );
}

// --- Small action helpers ---

function useAct() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function act(
    action: () => Promise<ActionResult<unknown>>,
    onDone?: (result: Extract<ActionResult<unknown>, { ok: true }>) => void,
  ): void {
    startTransition(async () => {
      const result = await action();
      if (!result) return;
      if (result.ok) {
        onDone?.(result);
        router.refresh();
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }
  return { pending, act };
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="text-text-3 ease-app hover:bg-surface-2 hover:text-text-1 flex size-7 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-150"
    >
      {children}
    </button>
  );
}

/** Toast for the bulk «Опубликовать уроки» action — count + skipped drafts. */
function bulkPublishDone(result: { data: unknown }): void {
  const { published, skipped } = result.data as { published: number; skipped: number };
  toast({
    title:
      published > 0
        ? `Опубликовано ${published} ${pluralRu(published, "урок", "урока", "уроков")}` +
          (skipped > 0 ? ` · ${skipped} пропущено (пустые)` : "")
        : "Нет валидных черновиков для публикации",
    variant: published > 0 ? "success" : "default",
  });
}

/** Название-подтверждение для диалогов с одним текстовым полем. */
function TitleDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  initialValue = "",
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  actionLabel: string;
  initialValue?: string;
  pending: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) onSubmit(value.trim());
          }}
          className="flex flex-col gap-4"
        >
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Название"
            autoFocus
            required
          />
          <DialogFooter className="mt-0">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" loading={pending} disabled={!value.trim()}>
              {actionLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  actionLabel: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button loading={pending} onClick={onConfirm}>
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Course card with nested modules/lessons ---

function CourseCard({ course }: { course: TreeCourse }) {
  const { pending, act } = useAct();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newModuleOpen, setNewModuleOpen] = useState(false);
  const [form, setForm] = useState({
    title: course.title,
    slug: course.slug,
    description: course.description,
    gating: course.gating as string,
  });

  useEffect(() => {
    setForm({
      title: course.title,
      slug: course.slug,
      description: course.description,
      gating: course.gating,
    });
  }, [course]);

  const published = course.status === "published";

  return (
    <div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
        <h2 className="min-w-0 truncate text-[16px] font-semibold">{course.title}</h2>
        <StatusBadge status={course.status} />
        <Badge>{GATING_OPTIONS.find((option) => option.value === course.gating)?.label}</Badge>
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction label="Редактировать курс" onClick={() => setEditOpen(true)}>
            <Pencil size={14} strokeWidth={1.75} />
          </IconAction>
          <IconAction
            label={published ? "Снять с публикации" : "Опубликовать курс"}
            onClick={() =>
              act(
                () => setCourseStatusAction(course.id, published ? "draft" : "published"),
                () =>
                  toast({
                    title: published ? "Курс снят с публикации" : "Курс опубликован",
                    variant: "success",
                  }),
              )
            }
          >
            {published ? (
              <EyeOff size={14} strokeWidth={1.75} />
            ) : (
              <Eye size={14} strokeWidth={1.75} />
            )}
          </IconAction>
          {course.modules.some((m) => m.lessons.some((l) => l.status === "draft")) && (
            <IconAction
              label="Опубликовать все уроки курса"
              onClick={() =>
                act(
                  () => publishLessonsAction({ kind: "course", courseId: course.id }),
                  bulkPublishDone,
                )
              }
            >
              <BookCheck size={14} strokeWidth={1.75} />
            </IconAction>
          )}
          <IconAction label="Добавить модуль" onClick={() => setNewModuleOpen(true)}>
            <FolderPlus size={14} strokeWidth={1.75} />
          </IconAction>
          {course.status === "draft" && (
            <IconAction label="Удалить курс" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={14} strokeWidth={1.75} className="text-danger" />
            </IconAction>
          )}
        </div>
      </div>

      {/* Modules */}
      {course.modules.length > 0 ? (
        <div className="border-border mt-1 flex flex-col gap-2 border-l pl-3">
          <SortableList
            ids={course.modules.map((m) => m.id)}
            onReorder={(orderedIds) =>
              act(() =>
                reorderContentAction({
                  scope: { kind: "modules", courseId: course.id },
                  orderedIds,
                }),
              )
            }
          >
            {course.modules.map((module) => (
              <ModuleBlock key={module.id} module={module} />
            ))}
          </SortableList>
        </div>
      ) : (
        // Empty course (spec 5.5/12.1-A4): don't leave a bare header with no body.
        <p className="text-text-3 border-border mt-1 border-l py-2 pl-3 text-[13px]">
          Пока нет модулей — добавь первый кнопкой с папкой выше.
        </p>
      )}

      {/* Edit course dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Курс</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              act(
                () => updateCourseAction({ courseId: course.id, ...form }),
                () => {
                  setEditOpen(false);
                  toast({ title: "Курс сохранён", variant: "success" });
                },
              );
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`course-title-${course.id}`} className="text-text-2 text-[13px]">
                Название
              </label>
              <Input
                id={`course-title-${course.id}`}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`course-slug-${course.id}`} className="text-text-2 text-[13px]">
                Slug
              </label>
              <Input
                id={`course-slug-${course.id}`}
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                pattern="[a-z0-9-]+"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`course-desc-${course.id}`} className="text-text-2 text-[13px]">
                Описание
              </label>
              <textarea
                id={`course-desc-${course.id}`}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="rounded-control border-border text-text-1 ease-app placeholder:text-text-3 hover:border-border-strong w-full resize-y border bg-transparent px-3 py-2 text-[14px] transition-colors duration-150"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-text-2 text-[13px]">Гейтинг</span>
              <Select value={form.gating} onValueChange={(gating) => setForm({ ...form, gating })}>
                <SelectTrigger aria-label="Гейтинг">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GATING_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="mt-0">
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" loading={pending}>
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TitleDialog
        open={newModuleOpen}
        onOpenChange={setNewModuleOpen}
        title="Новый модуль"
        actionLabel="Создать"
        pending={pending}
        onSubmit={(title) =>
          act(
            () => createModuleAction(course.id, title),
            () => setNewModuleOpen(false),
          )
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Удалить курс «${course.title}»?`}
        description="Черновик будет удалён вместе с модулями и уроками. Действие необратимо."
        actionLabel="Удалить"
        pending={pending}
        onConfirm={() =>
          act(
            () => deleteCourseAction(course.id),
            () => {
              setDeleteOpen(false);
              router.refresh();
            },
          )
        }
      />
    </div>
  );
}

function ModuleBlock({ module }: { module: TreeModule }) {
  const { pending, act } = useAct();
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newLessonOpen, setNewLessonOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testForm, setTestForm] = useState({
    poolSize: module.test?.poolSize ?? 12,
    threshold: module.test?.threshold ?? 80,
    cooldownMinutes: module.test?.cooldownMinutes ?? 45,
    enabled: module.test?.enabled ?? true,
  });
  const published = module.status === "published";

  return (
    <SortableRow id={module.id} className="flex items-start gap-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-[14px] font-medium">{module.title}</h3>
          <StatusBadge status={module.status} />
          <div className="ml-auto flex items-center gap-0.5">
            <IconAction label="Переименовать модуль" onClick={() => setRenameOpen(true)}>
              <Pencil size={13} strokeWidth={1.75} />
            </IconAction>
            <IconAction
              label={published ? "Снять с публикации" : "Опубликовать модуль"}
              onClick={() =>
                act(
                  () => setModuleStatusAction(module.id, published ? "draft" : "published"),
                  () =>
                    toast({
                      title: published ? "Модуль снят с публикации" : "Модуль опубликован",
                      variant: "success",
                    }),
                )
              }
            >
              {published ? (
                <EyeOff size={13} strokeWidth={1.75} />
              ) : (
                <Eye size={13} strokeWidth={1.75} />
              )}
            </IconAction>
            {module.lessons.some((lesson) => lesson.status === "draft") && (
              <IconAction
                label="Опубликовать все уроки модуля"
                onClick={() =>
                  act(
                    () => publishLessonsAction({ kind: "module", moduleId: module.id }),
                    bulkPublishDone,
                  )
                }
              >
                <BookCheck size={13} strokeWidth={1.75} />
              </IconAction>
            )}
            <IconAction label="Добавить урок" onClick={() => setNewLessonOpen(true)}>
              <FilePlus2 size={13} strokeWidth={1.75} />
            </IconAction>
            <IconAction
              label={
                module.test?.enabled
                  ? "Тест модуля (включён)"
                  : module.test
                    ? "Тест модуля (выключен)"
                    : "Настроить тест модуля"
              }
              onClick={() => setTestOpen(true)}
            >
              <ClipboardCheck
                size={13}
                strokeWidth={1.75}
                className={module.test?.enabled ? "text-accent" : undefined}
              />
            </IconAction>
            {module.status === "draft" && (
              <IconAction label="Удалить модуль" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={13} strokeWidth={1.75} className="text-danger" />
              </IconAction>
            )}
          </div>
        </div>

        {module.lessons.length > 0 ? (
          <div className="border-border mt-1 flex flex-col border-l pl-3">
            <SortableList
              ids={module.lessons.map((l) => l.id)}
              onReorder={(orderedIds) =>
                act(() =>
                  reorderContentAction({
                    scope: { kind: "lessons", moduleId: module.id },
                    orderedIds,
                  }),
                )
              }
            >
              {module.lessons.map((lesson) => (
                <LessonRow key={lesson.id} lesson={lesson} />
              ))}
            </SortableList>
          </div>
        ) : (
          // Empty module (spec 5.5/12.1-A4): show a prompt instead of a blank body.
          <p className="text-text-3 border-border mt-1 border-l py-2 pl-3 text-[13px]">
            Пока нет уроков — добавь первый кнопкой с плюсом выше.
          </p>
        )}
      </div>

      <TitleDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Переименовать модуль"
        actionLabel="Сохранить"
        initialValue={module.title}
        pending={pending}
        onSubmit={(title) =>
          act(
            () => renameModuleAction(module.id, title),
            () => setRenameOpen(false),
          )
        }
      />
      <TitleDialog
        open={newLessonOpen}
        onOpenChange={setNewLessonOpen}
        title="Новый урок"
        description="Черновик откроется в редакторе."
        actionLabel="Создать"
        pending={pending}
        onSubmit={(title) =>
          act(
            () => createLessonAction(module.id, title),
            (result) => {
              setNewLessonOpen(false);
              const { id } = result.data as { id: string };
              router.push(`/admin/content/lessons/${id}`);
            },
          )
        }
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Удалить модуль «${module.title}»?`}
        description="Черновик будет удалён вместе с уроками. Действие необратимо."
        actionLabel="Удалить"
        pending={pending}
        onConfirm={() =>
          act(
            () => deleteModuleAction(module.id),
            () => setDeleteOpen(false),
          )
        }
      />

      {/* Настройка модульного теста (spec 8.5) */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Тест модуля «{module.title}»</DialogTitle>
            <DialogDescription>
              Пул — закрытые опубликованные вопросы уроков модуля; выборка случайная, экстерн — с
              порогом 90%.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <label className="flex items-center justify-between gap-3 text-[14px]">
              Тест включён (участвует в закрытии модуля)
              <Switch
                checked={testForm.enabled}
                onCheckedChange={(enabled) => setTestForm({ ...testForm, enabled })}
              />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`test-pool-${module.id}`} className="text-text-2 text-[13px]">
                  Вопросов
                </label>
                <Input
                  id={`test-pool-${module.id}`}
                  type="number"
                  min={1}
                  max={50}
                  value={testForm.poolSize}
                  onChange={(event) =>
                    setTestForm({ ...testForm, poolSize: Number(event.target.value) || 1 })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`test-threshold-${module.id}`} className="text-text-2 text-[13px]">
                  Порог, %
                </label>
                <Input
                  id={`test-threshold-${module.id}`}
                  type="number"
                  min={1}
                  max={100}
                  value={testForm.threshold}
                  onChange={(event) =>
                    setTestForm({ ...testForm, threshold: Number(event.target.value) || 80 })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`test-cooldown-${module.id}`} className="text-text-2 text-[13px]">
                  Кулдаун, мин
                </label>
                <Input
                  id={`test-cooldown-${module.id}`}
                  type="number"
                  min={0}
                  max={1440}
                  value={testForm.cooldownMinutes}
                  onChange={(event) =>
                    setTestForm({ ...testForm, cooldownMinutes: Number(event.target.value) || 0 })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTestOpen(false)}>
              Отмена
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                act(
                  () => upsertModuleTestAction({ moduleId: module.id, ...testForm }),
                  () => {
                    setTestOpen(false);
                    toast({ title: "Тест модуля сохранён", variant: "success" });
                  },
                )
              }
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SortableRow>
  );
}

function LessonRow({ lesson }: { lesson: TreeLesson }) {
  const { pending, act } = useAct();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <SortableRow id={lesson.id} className="flex items-center gap-1.5 py-0.5">
      <Link
        href={`/admin/content/lessons/${lesson.id}`}
        className="rounded-control ease-app hover:bg-surface-2 flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-[13px] transition-colors duration-150"
      >
        <StatusDot status={lesson.status} />
        <span className="text-text-1 min-w-0 truncate">{lesson.title}</span>
        {lesson.status === "draft" && <Badge variant="warning">черновик</Badge>}
        {lesson.isOptional && <Badge>необязательный</Badge>}
        <span className="text-text-3 ml-auto shrink-0 text-[12px]">
          {lesson.readingMinutes} мин
        </span>
      </Link>
      {lesson.status === "draft" && (
        <IconAction label="Удалить урок" onClick={() => setDeleteOpen(true)}>
          <Trash2 size={13} strokeWidth={1.75} className="text-danger" />
        </IconAction>
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Удалить урок «${lesson.title}»?`}
        description="Черновик будет удалён. Действие необратимо."
        actionLabel="Удалить"
        pending={pending}
        onConfirm={() =>
          act(
            () => deleteLessonAction(lesson.id),
            () => setDeleteOpen(false),
          )
        }
      />
    </SortableRow>
  );
}

export function ContentTree({ courses }: { courses: TreeCourse[] }) {
  const { pending, act } = useAct();
  const [newCourseOpen, setNewCourseOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold">Контент</h1>
        <Button onClick={() => setNewCourseOpen(true)}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          Курс
        </Button>
      </div>

      {courses.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderPlus}
            title="Пока нет курсов"
            description="Создай первый курс — кнопка выше."
          />
        </Card>
      ) : (
        <SortableList
          ids={courses.map((c) => c.id)}
          onReorder={(orderedIds) =>
            act(() => reorderContentAction({ scope: { kind: "courses" }, orderedIds }))
          }
        >
          <div className="flex flex-col gap-3">
            {courses.map((course) => (
              <SortableRow key={course.id} id={course.id} className="flex items-start gap-1.5">
                <Card className="min-w-0 flex-1 p-4">
                  <CourseCard course={course} />
                </Card>
              </SortableRow>
            ))}
          </div>
        </SortableList>
      )}

      <TitleDialog
        open={newCourseOpen}
        onOpenChange={setNewCourseOpen}
        title="Новый курс"
        description="Курс создаётся черновиком — ученики его не увидят до публикации."
        actionLabel="Создать"
        pending={pending}
        onSubmit={(title) =>
          act(
            () => createCourseAction(title),
            () => setNewCourseOpen(false),
          )
        }
      />
    </div>
  );
}
