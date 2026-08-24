import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LessonSteps } from "@/app/(admin)/admin/content/lessons/[id]/lesson-steps";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/content-admin", () => ({
  copyLessonAction: async () => ({ ok: true, data: { id: "copy" } }),
  copyLessonAsStepAction: async () => ({ ok: true, data: { id: "step-copy" } }),
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
  lessonSources: [
    { id: "lesson-1", title: "Целевой урок", label: "Курс 1 · Модуль 1 · Целевой урок" },
    { id: "lesson-2", title: "Источник", label: "Курс 2 · Модуль 2 · Источник" },
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

});
