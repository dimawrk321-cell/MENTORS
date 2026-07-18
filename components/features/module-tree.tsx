import Link from "next/link";
import { Check, Circle, ClipboardCheck, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { pluralRu } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

// ModuleTree (spec 5.3): галки завершённых, точка текущего, замки закрытых,
// метки «необязательный» и «обновлён»; строка модульного теста
// «сдан {score}% / доступен / закрыт» и «Сдать экстерном» (spec 8.3).

export interface ModuleTreeLesson {
  id: string;
  title: string;
  readingMinutes: number;
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

function LessonIcon({ lesson }: { lesson: ModuleTreeLesson }) {
  if (lesson.completed) {
    return <Check size={15} strokeWidth={2.25} className="text-success" aria-hidden="true" />;
  }
  if (!lesson.unlocked) {
    return <Lock size={14} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />;
  }
  return (
    <Circle
      size={9}
      strokeWidth={2}
      className={cn(lesson.current ? "fill-accent text-accent" : "text-border-strong")}
      aria-hidden="true"
    />
  );
}

function LessonRow({ lesson }: { lesson: ModuleTreeLesson }) {
  const inner = (
    <>
      <span className="flex w-5 shrink-0 items-center justify-center">
        <LessonIcon lesson={lesson} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[14px]",
          lesson.unlocked ? "text-text-1" : "text-text-3",
          lesson.completed && "text-text-2",
        )}
      >
        {lesson.title}
      </span>
      {lesson.updatedSinceCompletion && <Badge variant="accent">обновлён</Badge>}
      {lesson.isOptional && <Badge>необязательный</Badge>}
      <span className="text-text-3 shrink-0 text-[12px] max-sm:hidden">
        {lesson.readingMinutes} мин
      </span>
    </>
  );

  if (!lesson.unlocked) {
    return (
      <div
        aria-disabled="true"
        title="Урок откроется после завершения предыдущих"
        className="rounded-control flex items-center gap-2.5 px-2.5 py-2"
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={`/lessons/${lesson.id}`}
      aria-current={lesson.current ? "step" : undefined}
      className="rounded-control ease-app hover:bg-surface-2 flex items-center gap-2.5 px-2.5 py-2 transition-colors duration-150"
    >
      {inner}
    </Link>
  );
}

export function ModuleTree({ modules }: { modules: ModuleTreeModule[] }) {
  return (
    <div className="flex flex-col gap-5">
      {modules.map((module, index) => (
        <section key={module.id}>
          <header className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-2.5">
            <h2 className="text-[16px] font-semibold">
              <span className="text-text-3 mr-2">{index + 1}.</span>
              {module.title}
            </h2>
            <span className="text-text-3 text-[12px]">
              {module.completedRequired} из {module.totalRequired}{" "}
              {pluralRu(module.totalRequired, "урока", "уроков", "уроков")}
            </span>
          </header>
          <div className="flex flex-col">
            {module.lessons.length === 0 && !module.test ? (
              // Empty module (spec 5.5/12.1-A4): a published module with no lessons.
              <p className="text-text-3 px-2.5 py-2 text-[13px]">В этом модуле пока нет уроков.</p>
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
      ))}
    </div>
  );
}

function TestRow({ moduleId, test }: { moduleId: string; test: ModuleTreeTest }) {
  const inner = (
    <>
      <span className="flex w-5 shrink-0 items-center justify-center">
        {test.passed ? (
          <Check size={15} strokeWidth={2.25} className="text-success" aria-hidden="true" />
        ) : test.available || test.testoutAvailable ? (
          <ClipboardCheck size={15} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        ) : (
          <Lock size={14} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[14px]",
          test.passed || test.available || test.testoutAvailable ? "text-text-1" : "text-text-3",
        )}
      >
        Модульный тест
      </span>
      {test.passed ? (
        <Badge variant="success">сдан {test.bestScore}%</Badge>
      ) : test.available ? (
        <Badge variant="accent">доступен</Badge>
      ) : (
        <Badge>закрыт</Badge>
      )}
      {test.testoutAvailable && (
        <span className="text-accent shrink-0 text-[12px]">Сдать экстерном</span>
      )}
    </>
  );

  // Кликабельно, когда есть что сдавать или смотреть (разбор после сдачи).
  if (test.passed || test.available || test.testoutAvailable) {
    return (
      <Link
        href={test.testoutAvailable ? `/tests/${moduleId}?kind=testout` : `/tests/${moduleId}`}
        className="rounded-control ease-app hover:bg-surface-2 flex items-center gap-2.5 px-2.5 py-2 transition-colors duration-150"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div
      aria-disabled="true"
      title="Откроется после завершения уроков модуля"
      className="rounded-control flex items-center gap-2.5 px-2.5 py-2"
    >
      {inner}
    </div>
  );
}
