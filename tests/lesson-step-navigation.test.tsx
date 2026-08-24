import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("lesson step navigation", () => {
  let CompleteLessonStepButton: typeof import("@/components/features/lesson-step-navigation").CompleteLessonStepButton;

  beforeAll(async () => {
    ({ CompleteLessonStepButton } = await import("@/components/features/lesson-step-navigation"));
  });

  it("renders the next-step link as the single child of an asChild button", () => {
    const html = renderToStaticMarkup(
      <CompleteLessonStepButton
        lessonId="lesson-1"
        stepId="step-1"
        nextStepId="step-2"
        completed
      />,
    );

    expect(html).toContain('href="/lessons/lesson-1?step=step-2"');
    expect(html).toContain("Следующий шаг");
  });

  it("не предлагает следующий шаг, пока текущий не завершён", () => {
    const html = renderToStaticMarkup(
      <CompleteLessonStepButton
        lessonId="lesson-1"
        stepId="step-1"
        nextStepId="step-2"
        completed={false}
      />,
    );

    expect(html).toContain("Завершить шаг");
    expect(html).not.toContain("Следующий шаг");
    expect(html).not.toContain('href="/lessons/lesson-1?step=step-2"');
  });
});
