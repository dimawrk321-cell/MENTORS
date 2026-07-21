import Link from "next/link";
import { Check, ChevronDown, Circle, ClipboardCheck, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { ModuleTreeLesson, ModuleTreeModule, ModuleTreeTest } from "./module-tree";

// Mobile course view (walk 12.3, P2): modules as an accordion — only the module
// with the current lesson is open, the rest collapse to «заголовок + N/M». Lesson
// rows are ≥48px with the whole row as the tap target; locks/labels never wrap.
// Desktop keeps ModuleTree unchanged (this renders under `md:hidden`).

function LessonIcon({ lesson }: { lesson: ModuleTreeLesson }) {
  if (lesson.completed)
    return <Check size={16} strokeWidth={2.25} className="text-success" aria-hidden="true" />;
  if (!lesson.unlocked)
    return <Lock size={15} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />;
  return (
    <Circle
      size={10}
      strokeWidth={2}
      className={cn(lesson.current ? "fill-accent text-accent" : "text-border-strong")}
      aria-hidden="true"
    />
  );
}

const ROW = "flex min-h-12 items-center gap-3 px-3.5 py-2.5";

function LessonRow({ lesson }: { lesson: ModuleTreeLesson }) {
  const inner = (
    <>
      <span className="flex w-5 shrink-0 items-center justify-center">
        <LessonIcon lesson={lesson} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[15px]",
          !lesson.unlocked ? "text-text-3" : lesson.completed ? "text-text-2" : "text-text-1",
        )}
      >
        {lesson.title}
      </span>
      {lesson.updatedSinceCompletion && <Badge variant="accent">обновлён</Badge>}
      {lesson.isOptional && <Badge>необязательный</Badge>}
    </>
  );

  if (!lesson.unlocked) {
    return (
      <div
        className={cn(ROW, "opacity-60")}
        aria-disabled="true"
        title="Урок откроется после завершения предыдущих"
      >
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={`/lessons/${lesson.id}`}
      aria-current={lesson.current ? "step" : undefined}
      className={cn(ROW, "ease-app active:bg-surface-2 transition-colors duration-150")}
    >
      {inner}
    </Link>
  );
}

function TestRow({ moduleId, test }: { moduleId: string; test: ModuleTreeTest }) {
  const interactive = test.passed || test.available || test.testoutAvailable;
  const href =
    test.testoutAvailable && !test.available
      ? `/tests/${moduleId}?kind=testout`
      : `/tests/${moduleId}`;
  const icon = test.passed ? (
    <Check size={16} strokeWidth={2.25} className="text-success" aria-hidden="true" />
  ) : test.available || test.testoutAvailable ? (
    <ClipboardCheck size={15} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
  ) : (
    <Lock size={15} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />
  );
  const inner = (
    <>
      <span className="flex w-5 shrink-0 items-center justify-center">{icon}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[15px]",
          interactive ? "text-text-1" : "text-text-3",
        )}
      >
        Модульный тест
      </span>
      {test.passed ? (
        <Badge variant="success">сдан {test.bestScore}%</Badge>
      ) : test.available ? (
        <Badge variant="accent">доступен</Badge>
      ) : test.testoutAvailable ? (
        <span className="text-accent shrink-0 text-[12px]">экстерн</span>
      ) : (
        <Badge>закрыт</Badge>
      )}
    </>
  );

  if (!interactive) return <div className={cn(ROW, "opacity-60")}>{inner}</div>;
  return (
    <Link
      href={href}
      className={cn(ROW, "ease-app active:bg-surface-2 transition-colors duration-150")}
    >
      {inner}
    </Link>
  );
}

export function ModuleAccordion({ modules }: { modules: ModuleTreeModule[] }) {
  const anyCurrent = modules.some((m) => m.lessons.some((l) => l.current));
  return (
    <div className="flex flex-col gap-2">
      {modules.map((module, index) => {
        const hasCurrent = module.lessons.some((l) => l.current);
        // Open the module with the current lesson; if none exists yet, open the first.
        const open = hasCurrent || (!anyCurrent && index === 0);
        return (
          <details
            key={module.id}
            open={open}
            className="rounded-card border-border bg-surface-1 group overflow-hidden border"
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3.5 py-2.5">
              <span className="text-text-3 shrink-0 text-[13px] tabular-nums">{index + 1}</span>
              <span className="text-text-1 min-w-0 flex-1 text-[15px] font-semibold">
                {module.title}
              </span>
              <span className="text-text-3 shrink-0 text-[12px] tabular-nums">
                {module.completedRequired}/{module.totalRequired}
              </span>
              <ChevronDown
                size={16}
                strokeWidth={1.75}
                className="text-text-3 ease-app shrink-0 transition-transform duration-200 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="border-border flex flex-col border-t">
              {module.lessons.length === 0 && !module.test ? (
                <p className="text-text-3 px-3.5 py-3 text-[14px]">
                  В этом модуле пока нет уроков.
                </p>
              ) : (
                <>
                  {module.lessons.map((lesson) => (
                    <LessonRow key={lesson.id} lesson={lesson} />
                  ))}
                  {module.test && <TestRow moduleId={module.id} test={module.test} />}
                </>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/**
 * Sticky «Продолжить: {урок}» bar (walk 12.3, P2). Sits just above the BottomNav
 * (56px + safe-area) so it never overlaps it. Solid accent — the gradient is
 * reserved for the dashboard hero / goal ring / level-up (spec 5.1).
 */
export function CourseStickyCta({
  lessonId,
  lessonTitle,
}: {
  lessonId: string;
  lessonTitle: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 px-4 md:hidden">
      <Link
        href={`/lessons/${lessonId}`}
        className="bg-accent hover:bg-accent-hover ease-app rounded-control flex h-12 items-center justify-center gap-2 px-4 text-[15px] font-medium text-white shadow-[0_2px_16px_rgb(0_0_0/0.24)] transition-colors duration-150 active:scale-[.98]"
      >
        <span className="shrink-0 text-white/75">Продолжить:</span>
        <span className="truncate">{lessonTitle}</span>
      </Link>
    </div>
  );
}
