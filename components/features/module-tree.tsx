import Link from "next/link";
import type { LessonPathPolicy } from "@prisma/client";
import { ArrowRight, Check, ClipboardCheck, Lock, Play, SquareCheckBig } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { pluralRu } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { lessonKindLabel, lessonTotalMinutes } from "@/lib/utils/lesson-path";

// ModuleTree (spec 5.3, вид v2 — заход B.5 по референсу «PRIME - Курс»):
// модуль — компактная строка (номер или галка, название, «N/M · K мин»,
// мини-полоса прогресса), уроки — плашки-строки: отметка статуса, название,
// метка типа · минуты · практика, действие справа и стрелка.
//
// Что осталось прежним и почему: интерфейсы `ModuleTreeModule/Lesson/Test` не
// менялись — их собирает страница курса и повторно использует мобильный
// аккордеон (`module-accordion.tsx`), у которого своя раскладка под 390px.
// Строка модульного теста (сдан / доступен / закрыт / экстерн) в референсе не
// нарисована, но это функциональность из 7.5 — она остаётся, оформленная той же
// плашкой.

export interface ModuleTreeLesson {
  id: string;
  title: string;
  readingMinutes: number;
  pathPolicy: LessonPathPolicy;
  textMinutes: number | null;
  videoMinutes: number | null;
  practiceMinutes: number | null;
  hasVideo: boolean;
  isOptional: boolean;
  unlocked: boolean;
  completed: boolean;
  current: boolean;
  updatedSinceCompletion: boolean;
}

export interface ModuleTreeTest {
  passed: boolean;
  bestScore: number | null;
  /** Обычный тест доступен, когда обязательные уроки модуля завершены. */
  available: boolean;
  /** «Сдать экстерном» — незачтённый strict-модуль с непройденными уроками. */
  testoutAvailable: boolean;
}

export interface ModuleTreeModule {
  id: string;
  title: string;
  completedRequired: number;
  totalRequired: number;
  lessons: ModuleTreeLesson[];
  /** Присутствует только у модулей с enabled-тестом. */
  test?: ModuleTreeTest;
}

/** Плашка строки программы — общая геометрия урока и модульного теста. */
const PLATE =
  "rounded-card border-border bg-surface-1 shadow-card ease-app flex min-h-[62px] items-center gap-3 border px-4 py-3 transition-colors duration-150";

function LessonMark({ lesson }: { lesson: ModuleTreeLesson }) {
  const base =
    "flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold";
  if (lesson.completed) {
    return (
      <span className={cn(base, "bg-success/15 text-success")} aria-hidden="true">
        <Check size={13} strokeWidth={2.5} />
      </span>
    );
  }
  if (!lesson.unlocked) {
    return (
      <span className={cn(base, "border-border text-text-3 border")} aria-hidden="true">
        <Lock size={11} strokeWidth={2} />
      </span>
    );
  }
  if (lesson.current) {
    return (
      <span
        className={cn(base, "text-white")}
        style={{ backgroundImage: "var(--gradient-accent)" }}
        aria-hidden="true"
      >
        <Play size={10} strokeWidth={2} fill="currentColor" />
      </span>
    );
  }
  return <span className={cn(base, "border-border-strong border")} aria-hidden="true" />;
}

function LessonRow({ lesson }: { lesson: ModuleTreeLesson }) {
  const kind = lessonKindLabel(lesson);
  const minutes = lessonTotalMinutes(lesson);
  const foot = lesson.completed
    ? { label: "Пройден", className: "text-success" }
    : lesson.current
      ? { label: "Продолжить", className: "text-accent" }
      : !lesson.unlocked
        ? { label: "Откроется позже", className: "text-text-3" }
        : { label: "Начать", className: "text-text-2" };

  const inner = (
    <>
      <LessonMark lesson={lesson} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-[14.5px] leading-snug font-semibold tracking-[-0.01em]",
              lesson.unlocked ? "text-text-1" : "text-text-3",
            )}
          >
            {lesson.title}
          </span>
          {lesson.updatedSinceCompletion && <Badge variant="accent">обновлён</Badge>}
          {lesson.isOptional && <Badge>необязательный</Badge>}
        </span>
        <span className="text-text-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span
            className={cn(
              "text-[11px] font-semibold tracking-[0.05em] uppercase",
              kind.isVideo ? "text-violet" : "text-text-3",
            )}
          >
            {kind.label}
          </span>
          <span aria-hidden="true" className="bg-text-3 size-[3px] rounded-full" />
          <span className="tabular-nums">{minutes} мин</span>
          {lesson.practiceMinutes ? (
            <>
              <span aria-hidden="true" className="bg-text-3 size-[3px] rounded-full" />
              <span className="inline-flex items-center gap-1.5">
                <SquareCheckBig size={12} strokeWidth={1.75} aria-hidden="true" />
                практика
              </span>
            </>
          ) : null}
        </span>
      </span>
      <span className={cn("shrink-0 text-[12px] font-semibold max-sm:hidden", foot.className)}>
        {foot.label}
      </span>
      <ArrowRight
        size={15}
        strokeWidth={1.75}
        aria-hidden="true"
        className={cn(
          "shrink-0",
          lesson.current ? "text-accent" : "text-text-3",
          lesson.unlocked ? "opacity-80" : "opacity-0",
        )}
      />
    </>
  );

  if (!lesson.unlocked) {
    return (
      <div
        aria-disabled="true"
        title="Урок откроется после завершения предыдущих"
        className={cn(PLATE, "border-dashed opacity-60")}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={`/lessons/${lesson.id}`}
      aria-current={lesson.current ? "step" : undefined}
      className={cn(
        PLATE,
        "hover:border-border-strong",
        lesson.current && "border-accent/45 bg-accent/[0.06]",
      )}
    >
      {inner}
    </Link>
  );
}

export function ModuleTree({ modules }: { modules: ModuleTreeModule[] }) {
  return (
    <div className="flex flex-col gap-[22px]">
      {modules.map((module, index) => {
        const done = module.completedRequired === module.totalRequired && module.totalRequired > 0;
        const minutes = module.lessons.reduce((sum, lesson) => sum + lessonTotalMinutes(lesson), 0);
        const pct =
          module.totalRequired === 0
            ? 0
            : Math.round((module.completedRequired / module.totalRequired) * 100);
        return (
          <section key={module.id}>
            <header className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-[8px] text-[11.5px] font-bold",
                  done ? "bg-success/15 text-success" : "text-white",
                )}
                style={done ? undefined : { backgroundImage: "var(--gradient-accent)" }}
              >
                {done ? <Check size={13} strokeWidth={2.5} /> : index + 1}
              </span>
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">{module.title}</h2>
              <span className="text-text-3 text-[12px]">
                {module.completedRequired}/{module.totalRequired}{" "}
                {pluralRu(module.totalRequired, "урок", "урока", "уроков")} · {minutes} мин
              </span>
              <span
                aria-hidden="true"
                className="bg-surface-2 ml-auto h-1 w-[72px] shrink-0 overflow-hidden rounded-[2px]"
              >
                <span
                  className="block h-full rounded-[2px]"
                  style={{ width: `${pct}%`, backgroundImage: "var(--gradient-accent)" }}
                />
              </span>
            </header>
            <div className="flex flex-col gap-2">
              {module.lessons.length === 0 && !module.test ? (
                // Empty module (spec 5.5/12.1-A4): a published module with no lessons.
                <p className="text-text-3 px-1 py-2 text-[13px]">В этом модуле пока нет уроков.</p>
              ) : (
                <>
                  {module.lessons.map((lesson) => (
                    <LessonRow key={lesson.id} lesson={lesson} />
                  ))}
                  {module.test && <TestRow moduleId={module.id} test={module.test} />}
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TestRow({ moduleId, test }: { moduleId: string; test: ModuleTreeTest }) {
  const interactive = test.passed || test.available || test.testoutAvailable;
  const inner = (
    <>
      <span
        className={cn(
          "flex size-[22px] shrink-0 items-center justify-center rounded-full",
          test.passed ? "bg-success/15 text-success" : "border-border text-text-3 border",
        )}
        aria-hidden="true"
      >
        {test.passed ? (
          <Check size={13} strokeWidth={2.5} />
        ) : interactive ? (
          <ClipboardCheck size={12} strokeWidth={1.75} className="text-accent" />
        ) : (
          <Lock size={11} strokeWidth={2} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "text-[14.5px] leading-snug font-semibold tracking-[-0.01em]",
            interactive ? "text-text-1" : "text-text-3",
          )}
        >
          Модульный тест
        </span>
        <span className="text-text-3 flex flex-wrap items-center gap-2 text-[12px]">
          {test.passed ? (
            <Badge variant="success">сдан {test.bestScore}%</Badge>
          ) : test.available ? (
            <Badge variant="accent">доступен</Badge>
          ) : (
            <Badge>закрыт</Badge>
          )}
          {test.testoutAvailable && <span className="text-accent">можно сдать экстерном</span>}
        </span>
      </span>
      <ArrowRight
        size={15}
        strokeWidth={1.75}
        aria-hidden="true"
        className={cn("text-text-3 shrink-0", interactive ? "opacity-80" : "opacity-0")}
      />
    </>
  );

  // Кликабельно, когда есть что сдавать или смотреть (разбор после сдачи).
  if (interactive) {
    return (
      <Link
        href={
          test.testoutAvailable && !test.available
            ? `/tests/${moduleId}?kind=testout`
            : `/tests/${moduleId}`
        }
        className={cn(PLATE, "hover:border-border-strong")}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div
      aria-disabled="true"
      title="Откроется после завершения уроков модуля"
      className={cn(PLATE, "border-dashed opacity-60")}
    >
      {inner}
    </div>
  );
}
