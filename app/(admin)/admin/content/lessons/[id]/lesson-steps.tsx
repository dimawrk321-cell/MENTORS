"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  GripVertical,
  ListPlus,
  Pencil,
  Plus,
  Split,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  copyLessonAction,
  copyLessonsAsStepsAction,
  createLessonStepAction,
  deleteLessonStepAction,
  moveLessonStepAction,
  moveLessonToModuleAction,
  renameLessonStepAction,
  splitLessonIntoStepsAction,
} from "@/lib/actions/content-admin";
import { cn } from "@/lib/utils/cn";

interface StepItem {
  id: string;
  title: string;
}

export interface StepSourceLesson {
  id: string;
  title: string;
  label: string;
  scope: "module" | "course";
}

/**
 * Заход C.10. Главное непонимание механизма — «шаг ссылается на урок». Он его
 * КОПИРУЕТ, и дальше копия живёт своей жизнью. Формулировка живёт константой,
 * а не в JSX: её же охраняет тест (содержимое диалога Radix в статическую
 * разметку не попадает, пока диалог закрыт).
 */
export const STEP_COPY_NOTICE = {
  title: "Шаг — это копия, а не ссылка.",
  body:
    "Материал переносится снимком: правки исходного урока в шаг больше не приходят, " +
    "и наоборот. Сам исходный урок останется отдельной строкой в программе курса — " +
    "если он опубликован, ученик увидит материал дважды, пока урок не снят с публикации.",
} as const;

/**
 * Область поиска источников. По умолчанию — модуль: собирать шагами уроки
 * соседнего модуля почти всегда значит подменять шагами группировку, ради
 * которой модуль и существует. Расширение до курса — явное действие.
 */
export function stepSourceScopeOptions(
  sources: readonly StepSourceLesson[],
): ReadonlyArray<{ value: "module" | "course"; label: string }> {
  const inModule = sources.filter((item) => item.scope === "module").length;
  return [
    { value: "module", label: `Этот модуль · ${inModule}` },
    { value: "course", label: `Весь курс · ${sources.length}` },
  ];
}

export function LessonSteps({
  lessonId,
  lessonTitle,
  lessonStatus,
  moduleId,
  steps,
  activeStepId,
  modules,
  lessons,
  copyTargets,
  lessonSources,
}: {
  lessonId: string;
  lessonTitle: string;
  lessonStatus: "draft" | "published";
  moduleId: string;
  steps: StepItem[];
  activeStepId: string | null;
  modules: Array<{ id: string; title: string }>;
  lessons: Array<{ id: string; title: string }>;
  copyTargets: Array<{ id: string; title: string }>;
  lessonSources: StepSourceLesson[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [deletingStep, setDeletingStep] = useState<StepItem | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTitle, setCopyTitle] = useState(`${lessonTitle} — копия`);
  const [copyTargetModuleId, setCopyTargetModuleId] = useState(moduleId);
  const [importOpen, setImportOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceScope, setSourceScope] = useState<"module" | "course">("module");
  const [sourceLessonIds, setSourceLessonIds] = useState<string[]>([]);
  const [importTitle, setImportTitle] = useState("");

  function run(
    work: () => Promise<{ ok: boolean; error?: { message: string }; data?: unknown }>,
    done?: (data: unknown) => void,
  ) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast({ title: result.error?.message ?? "Не получилось сохранить", variant: "danger" });
        return;
      }
      done?.(result.data);
      router.refresh();
    });
  }

  const scopeOptions = stepSourceScopeOptions(lessonSources);
  const availableSources =
    sourceScope === "module"
      ? lessonSources.filter((item) => item.scope === "module")
      : lessonSources;
  const normalizedQuery = sourceQuery.trim().toLocaleLowerCase("ru");
  const filteredSources = normalizedQuery
    ? availableSources.filter((item) =>
        item.label.toLocaleLowerCase("ru").includes(normalizedQuery),
      )
    : availableSources;
  // Выбор считается по полному списку курса, а не по видимой области: сужение
  // обратно до модуля не должно молча выбрасывать уже отмеченный урок.
  const selectedSources = sourceLessonIds.flatMap((id) => {
    const source = lessonSources.find((item) => item.id === id);
    return source ? [source] : [];
  });

  function toggleSource(source: (typeof lessonSources)[number]) {
    const nextIds = sourceLessonIds.includes(source.id)
      ? sourceLessonIds.filter((id) => id !== source.id)
      : [...sourceLessonIds, source.id];
    setSourceLessonIds(nextIds);
    if (nextIds.length === 1) {
      setImportTitle(lessonSources.find((item) => item.id === nextIds[0])?.title ?? "");
    } else {
      setImportTitle("");
    }
  }

  const reuseButtons = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setCopyTitle(`${lessonTitle} — копия`);
          setCopyTargetModuleId(moduleId);
          setCopyOpen(true);
        }}
      >
        <Copy size={15} aria-hidden="true" /> Копировать урок
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={availableSources.length === 0}
        onClick={() => {
          setSourceQuery("");
          setSourceLessonIds([]);
          setImportTitle("");
          setImportOpen(true);
        }}
      >
        <ListPlus size={15} aria-hidden="true" /> Добавить урок как шаг
      </Button>
    </div>
  );

  const reuseDialogs = (
    <>
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Копировать урок</DialogTitle>
            <DialogDescription>
              Создаст самостоятельный черновик со всем контентом, шагами и вопросами. Прогресс
              учеников и публикация не копируются.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!copyTitle.trim() || !copyTargetModuleId) return;
              run(
                () =>
                  copyLessonAction({
                    sourceLessonId: lessonId,
                    targetModuleId: copyTargetModuleId,
                    title: copyTitle,
                  }),
                (data) => {
                  const result = data as {
                    id: string;
                    copiedStepCount: number;
                    copiedQuestionCount: number;
                  };
                  setCopyOpen(false);
                  toast({
                    title: "Копия урока создана",
                    description: `Шагов: ${result.copiedStepCount} · вопросов: ${result.copiedQuestionCount}`,
                    variant: "success",
                  });
                  router.push(`/admin/content/lessons/${result.id}`);
                },
              );
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-text-2">Название копии</span>
              <Input
                value={copyTitle}
                onChange={(event) => setCopyTitle(event.target.value)}
                maxLength={200}
                autoFocus
                required
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-text-2">Курс и модуль</span>
              <Select value={copyTargetModuleId} onValueChange={setCopyTargetModuleId}>
                <SelectTrigger aria-label="Курс и модуль для копии">
                  <SelectValue placeholder="Выбери модуль" />
                </SelectTrigger>
                <SelectContent>
                  {copyTargets.map((target) => (
                    <SelectItem key={target.id} value={target.id}>
                      {target.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCopyOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" loading={pending} disabled={!copyTitle.trim()}>
                Создать копию
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Добавить урок как шаг</DialogTitle>
            <DialogDescription>
              Выбери один или несколько уроков. Они добавятся в текущий урок независимыми шагами
              вместе с материалом, видео и вопросами; источники останутся без изменений.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-control border-border bg-surface-2 text-text-2 border px-3 py-2 text-sm">
            <strong className="text-text-1 font-medium">{STEP_COPY_NOTICE.title}</strong>{" "}
            {STEP_COPY_NOTICE.body}
          </p>
          {lessonStatus === "published" && (
            <p className="rounded-control border-warning/35 bg-warning/6 text-text-2 border px-3 py-2 text-sm">
              Текущий урок опубликован: новый шаг сразу увидят ученики. У уже завершивших урок
              завершение не отменится, а у нового шага не будет старого прогресса.
            </p>
          )}
          <div className="flex flex-col gap-4">
            {/* Область по умолчанию — модуль: собирать шагами уроки соседнего
                модуля почти всегда значит подменять шагами группировку, для
                которой модуль и существует. Расширение до курса — явное. */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-text-2">Откуда брать:</span>
              <div className="border-border rounded-control inline-flex overflow-hidden border">
                {scopeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={sourceScope === option.value}
                    onClick={() => setSourceScope(option.value)}
                    className={cn(
                      "ease-app px-3 py-1.5 text-[13px] transition-colors duration-150",
                      sourceScope === option.value
                        ? "bg-accent/12 text-accent"
                        : "text-text-2 hover:bg-surface-2 hover:text-text-1",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <Input
              value={sourceQuery}
              onChange={(event) => setSourceQuery(event.target.value)}
              placeholder={
                sourceScope === "module" ? "Найти урок в этом модуле" : "Найти урок в этом курсе"
              }
              aria-label="Поиск исходного урока"
              autoFocus
            />
            <div className="border-border max-h-64 overflow-y-auto rounded-lg border p-1">
              {filteredSources.length > 0 ? (
                filteredSources.map((source) => {
                  const selectedIndex = sourceLessonIds.indexOf(source.id);
                  const selected = selectedIndex >= 0;
                  return (
                    <label
                      key={source.id}
                      className={cn(
                        "rounded-control flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                        selected
                          ? "bg-accent/12 text-text-1"
                          : "text-text-2 hover:bg-surface-2 hover:text-text-1",
                      )}
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleSource(source)}
                        aria-label={`Выбрать урок ${source.title}`}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1 break-words">{source.label}</span>
                      {selected && (
                        <span className="bg-accent/15 text-accent flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums">
                          {selectedIndex + 1}
                        </span>
                      )}
                    </label>
                  );
                })
              ) : (
                <p className="text-text-3 px-3 py-6 text-center text-sm">
                  {sourceScope === "module" && !normalizedQuery
                    ? "В этом модуле больше нет уроков."
                    : "Ничего не найдено."}{" "}
                  {sourceScope === "module" && (
                    <button
                      type="button"
                      onClick={() => setSourceScope("course")}
                      className="text-accent hover:text-accent-hover ease-app transition-colors duration-150"
                    >
                      Искать по всему курсу
                    </button>
                  )}
                </p>
              )}
            </div>
            {selectedSources.length === 1 && (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-text-2">Название нового шага</span>
                <Input
                  value={importTitle}
                  onChange={(event) => setImportTitle(event.target.value)}
                  maxLength={200}
                  required
                />
              </label>
            )}
            {selectedSources.length > 1 && (
              <div className="border-border bg-surface-2 rounded-lg border p-3">
                <p className="text-text-2 text-sm font-medium">
                  Порядок добавления · {selectedSources.length}
                </p>
                <ol className="text-text-3 mt-2 flex max-h-32 list-decimal flex-col gap-1 overflow-y-auto pl-5 text-xs">
                  {selectedSources.map((source) => (
                    <li key={source.id} className="pl-1">
                      {source.label}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              Отмена
            </Button>
            <Button
              loading={pending}
              disabled={
                selectedSources.length === 0 ||
                (selectedSources.length === 1 && !importTitle.trim())
              }
              onClick={() =>
                run(
                  () =>
                    copyLessonsAsStepsAction({
                      targetLessonId: lessonId,
                      sources: selectedSources.map((source) => ({
                        sourceLessonId: source.id,
                        title: selectedSources.length === 1 ? importTitle : source.title,
                      })),
                    }),
                  (data) => {
                    const result = data as {
                      ids: string[];
                      copiedQuestionCount: number;
                      skippedQuestionCount: number;
                      recordingNotice: boolean;
                    };
                    setImportOpen(false);
                    toast({
                      title: `Добавлено шагов: ${result.ids.length}`,
                      description:
                        `Вопросов перенесено: ${result.copiedQuestionCount}` +
                        (result.skippedQuestionCount > 0
                          ? ` · уже были в уроке: ${result.skippedQuestionCount}`
                          : ""),
                      variant: result.recordingNotice ? "warning" : "success",
                    });
                    const firstStepId = result.ids[0];
                    if (firstStepId) {
                      router.push(`/admin/content/lessons/${lessonId}?step=${firstStepId}`);
                    }
                  },
                )
              }
            >
              Добавить выбранные ({selectedSources.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (steps.length === 0) {
    return (
      <section className="border-border bg-surface-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div>
          <p className="font-medium">Шаги урока</p>
          <p className="text-text-3 mt-1 text-sm">
            Сейчас это обычный цельный урок. Разделение не изменит его текст.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reuseButtons}
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() =>
              run(
                () => splitLessonIntoStepsAction(lessonId),
                (data) => {
                  const id = (data as { id: string }).id;
                  router.push(`/admin/content/lessons/${lessonId}?step=${id}`);
                },
              )
            }
          >
            <Split size={15} aria-hidden="true" /> Разделить на шаги
          </Button>
        </div>
        {reuseDialogs}
      </section>
    );
  }

  return (
    <section className="border-border bg-surface-1 rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Шаги урока</p>
          <p className="text-text-3 text-sm">
            Каждый шаг — самостоятельный мини-урок с контентом и вопросами.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reuseButtons}
          <span className="text-text-3 min-w-6 text-right text-sm">{steps.length}</span>
        </div>
      </div>
      {modules.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-3">Раздел урока</span>
          <Select
            value={moduleId}
            onValueChange={(targetModuleId) =>
              run(
                () => moveLessonToModuleAction({ lessonId, targetModuleId }),
                () => toast({ title: "Урок перемещён", variant: "success" }),
              )
            }
          >
            <SelectTrigger className="w-64" aria-label="Переместить урок в раздел">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modules.map((module) => (
                <SelectItem key={module.id} value={module.id}>
                  {module.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {steps.map((step, index) => (
          <div
            key={step.id}
            draggable={editingId !== step.id}
            onDragStart={() => setDraggingId(step.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!draggingId || draggingId === step.id) return;
              run(() =>
                moveLessonStepAction({
                  stepId: draggingId,
                  targetLessonId: lessonId,
                  targetIndex: index,
                }),
              );
              setDraggingId(null);
            }}
            className={cn(
              "border-border flex min-w-0 items-center rounded-lg border",
              step.id === activeStepId && "border-accent bg-accent/10",
              draggingId === step.id && "opacity-50",
            )}
          >
            {editingId === step.id ? (
              <form
                className="flex items-center gap-1 p-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(
                    () => renameLessonStepAction({ stepId: step.id, title: editingTitle }),
                    () => setEditingId(null),
                  );
                }}
              >
                <Input
                  className="h-8 w-44"
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  autoFocus
                />
                <Button size="sm" variant="ghost" type="submit" aria-label="Сохранить название">
                  <Check size={15} />
                </Button>
              </form>
            ) : (
              <>
                <GripVertical
                  size={14}
                  className="text-text-3 ml-2 shrink-0 cursor-grab"
                  aria-label="Перетащить шаг"
                />
                <Link
                  className="max-w-56 truncate px-3 py-2 text-sm"
                  href={`/admin/content/lessons/${lessonId}?step=${step.id}`}
                >
                  {index + 1}. {step.title}
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Переименовать шаг"
                  onClick={() => {
                    setEditingId(step.id);
                    setEditingTitle(step.title);
                  }}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === 0 || pending}
                  aria-label="Поднять шаг"
                  onClick={() =>
                    run(() =>
                      moveLessonStepAction({
                        stepId: step.id,
                        targetLessonId: lessonId,
                        targetIndex: index - 1,
                      }),
                    )
                  }
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === steps.length - 1 || pending}
                  aria-label="Опустить шаг"
                  onClick={() =>
                    run(() =>
                      moveLessonStepAction({
                        stepId: step.id,
                        targetLessonId: lessonId,
                        targetIndex: index + 1,
                      }),
                    )
                  }
                >
                  <ArrowDown size={14} />
                </Button>
                {steps.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Удалить шаг"
                    onClick={() => setDeletingStep(step)}
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
                {steps.length > 1 && lessons.some((item) => item.id !== lessonId) && (
                  <Select
                    value="move"
                    onValueChange={(targetLessonId) =>
                      run(
                        () =>
                          moveLessonStepAction({
                            stepId: step.id,
                            targetLessonId,
                            targetIndex: 500,
                          }),
                        () =>
                          router.push(`/admin/content/lessons/${targetLessonId}?step=${step.id}`),
                      )
                    }
                  >
                    <SelectTrigger
                      className="mr-1 h-8 w-36"
                      aria-label="Переместить шаг в другой урок"
                    >
                      <SelectValue placeholder="В другой урок" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="move" disabled>
                        В другой урок
                      </SelectItem>
                      {lessons
                        .filter((item) => item.id !== lessonId)
                        .map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.title}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <Dialog open={deletingStep !== null} onOpenChange={(open) => !open && setDeletingStep(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить шаг «{deletingStep?.title}»?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Шаг и весь прогресс учеников по нему будут удалены без возможности восстановления.
                </p>
                <p>
                  Вопросы не удалятся из банка: они останутся в этом уроке без привязки к шагу.
                  Остальные шаги и их прогресс не изменятся.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeletingStep(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                if (!deletingStep) return;
                const stepId = deletingStep.id;
                run(
                  () => deleteLessonStepAction(stepId),
                  (data) => {
                    const result = data as { deletedProgressCount: number };
                    setDeletingStep(null);
                    toast({
                      title: `Шаг удалён. Записей прогресса удалено: ${result.deletedProgressCount}`,
                      variant: "success",
                    });
                    if (activeStepId === stepId) {
                      router.replace(`/admin/content/lessons/${lessonId}`);
                    }
                  },
                );
              }}
            >
              Удалить шаг и прогресс
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <form
        className="mt-3 flex max-w-md gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newTitle.trim()) return;
          run(
            () => createLessonStepAction({ lessonId, title: newTitle }),
            (data) => {
              setNewTitle("");
              router.push(`/admin/content/lessons/${lessonId}?step=${(data as { id: string }).id}`);
            },
          );
        }}
      >
        <Input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="Название нового шага"
        />
        <Button type="submit" variant="secondary" loading={pending}>
          <Plus size={16} /> Добавить
        </Button>
      </form>
      {reuseDialogs}
    </section>
  );
}
