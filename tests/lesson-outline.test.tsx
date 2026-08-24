import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LessonTocRail, LessonTocSheet } from "@/components/features/lesson-toc";

const STEPS = [
  { id: "step-1", title: "Материал", completed: true, unlocked: true },
  { id: "step-2", title: "Практика", completed: false, unlocked: true },
  { id: "step-3", title: "Итоги", completed: false, unlocked: false },
];

describe("ученическая навигация по шагам", () => {
  it("показывает шаги вертикально и темы текущего шага в правой колонке", () => {
    const html = renderToStaticMarkup(
      <LessonTocRail
        lessonId="lesson-1"
        steps={STEPS}
        activeStepId="step-2"
        title="В этом шаге"
        headings={[
          { id: "intro", text: "Введение", depth: 2 },
          { id: "practice", text: "Практика", depth: 2 },
        ]}
      />,
    );

    expect(html).toContain("Шаги урока");
    expect(html).toContain("В этом шаге");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('href="/lessons/lesson-1?step=step-2"');
    expect(html).toContain("Шаг 2");
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href="/lessons/lesson-1?step=step-3"');
    expect(html).toContain("[scrollbar-width:none]");
    expect(html).not.toContain("overflow-x-auto");
  });

  it("оставляет навигацию доступной на узком экране даже без оглавления", () => {
    const html = renderToStaticMarkup(
      <LessonTocSheet
        lessonId="lesson-1"
        steps={STEPS}
        activeStepId="step-2"
        title="В этом шаге"
        headings={[]}
      />,
    );

    expect(html).toContain("Шаг 2 из 3");
  });

  it("не добавляет искусственную навигацию цельному уроку", () => {
    const html = renderToStaticMarkup(<LessonTocRail headings={[]} />);
    expect(html).not.toContain("Шаги урока");
    expect(html).toContain('aria-hidden="true"');
  });
});
