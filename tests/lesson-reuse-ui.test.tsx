import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  LessonSteps,
  STEP_COPY_NOTICE,
  stepSourceScopeOptions,
} from "@/app/(admin)/admin/content/lessons/[id]/lesson-steps";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/content-admin", () => ({
  copyLessonAction: async () => ({ ok: true, data: { id: "copy" } }),
  copyLessonAsStepAction: async () => ({ ok: true, data: { id: "step-copy" } }),
  copyLessonsAsStepsAction: async () => ({ ok: true, data: { ids: ["step-copy"] } }),
  createLessonStepAction: async () => ({ ok: true, data: { id: "step" } }),
  deleteLessonStepAction: async () => ({ ok: true, data: {} }),
  moveLessonStepAction: async () => ({ ok: true }),
  moveLessonToModuleAction: async () => ({ ok: true }),
  renameLessonStepAction: async () => ({ ok: true }),
  splitLessonIntoStepsAction: async () => ({ ok: true, data: { id: "step" } }),
}));

const COMMON = {
  lessonId: "lesson-1",
  lessonTitle: "Целевой урок",
  lessonStatus: "draft" as const,
  moduleId: "module-1",
  activeStepId: null,
  modules: [{ id: "module-1", title: "Модуль 1" }],
  lessons: [
    { id: "lesson-1", title: "Модуль 1 · Целевой урок" },
    { id: "lesson-2", title: "Модуль 1 · Источник" },
  ],
  copyTargets: [
    { id: "module-1", title: "Курс 1 · Модуль 1" },
    { id: "module-2", title: "Курс 2 · Модуль 2" },
  ],
  // Заход C.10: источники ограничены курсом, текущий урок отсеян на сервере,
  // а область по умолчанию — модуль урока.
  lessonSources: [
    {
      id: "lesson-2",
      title: "Сосед по модулю",
      label: "Модуль 1 · Сосед по модулю",
      scope: "module" as const,
    },
    {
      id: "lesson-3",
      title: "Урок из другого модуля",
      label: "Модуль 2 · Урок из другого модуля",
      scope: "course" as const,
    },
  ],
};

describe("повторное использование уроков в редакторе", () => {
  it("показывает копирование и импорт шага у цельного урока", () => {
    const html = renderToStaticMarkup(<LessonSteps {...COMMON} steps={[]} />);
    expect(html).toContain("Копировать урок");
    expect(html).toContain("Добавить урок как шаг");
    expect(html).toContain("Разделить на шаги");
  });

  it("оставляет обе операции доступными после разделения на шаги", () => {
    const html = renderToStaticMarkup(
      <LessonSteps
        {...COMMON}
        steps={[{ id: "step-1", title: "Материал" }]}
        activeStepId="step-1"
      />,
    );
    expect(html).toContain("Копировать урок");
    expect(html).toContain("Добавить урок как шаг");
    expect(html).toContain("1. Материал");
  });

  // Содержимое диалога Radix в статическую разметку не попадает, пока он
  // закрыт, поэтому тексты и счётчики областей проверяются в своих константах,
  // а не в HTML. Что они действительно отрисованы — проверка глазами на 1280/390.
  it("называет шаг копией и предупреждает про оставшийся исходный урок", () => {
    expect(STEP_COPY_NOTICE.title).toBe("Шаг — это копия, а не ссылка.");
    expect(STEP_COPY_NOTICE.body).toContain("правки исходного урока в шаг больше не приходят");
    expect(STEP_COPY_NOTICE.body).toContain("ученик увидит материал дважды");
  });

  it("по умолчанию считает уроки своего модуля, расширение до курса — отдельная область", () => {
    expect(stepSourceScopeOptions(COMMON.lessonSources)).toEqual([
      { value: "module", label: "Этот модуль · 1" },
      { value: "course", label: "Весь курс · 2" },
    ]);
  });
});
