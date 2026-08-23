"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical, Pencil, Plus, Split, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function LessonSteps({
  lessonId,
  moduleId,
  steps,
  activeStepId,
  modules,
  lessons,
}: {
  lessonId: string;
  moduleId: string;
  steps: StepItem[];
  activeStepId: string | null;
  modules: Array<{ id: string; title: string }>;
  lessons: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);

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

  if (steps.length === 0) {
    return (
      <section className="border-border bg-surface-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div>
          <p className="font-medium">Шаги урока</p>
          <p className="text-text-3 mt-1 text-sm">
            Сейчас это обычный цельный урок. Разделение не изменит его текст.
          </p>
        </div>
        <Button
          variant="secondary"
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
          <Split size={16} aria-hidden="true" /> Разделить на шаги
        </Button>
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
        <span className="text-text-3 text-sm">{steps.length}</span>
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
                    onClick={() => run(() => deleteLessonStepAction(step.id))}
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
    </section>
  );
}
