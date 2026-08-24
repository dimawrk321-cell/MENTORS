import { describe, expect, it } from "vitest";
import { resolveAccessibleLessonStep, withLessonStepAccess } from "@/lib/utils/lesson-step-access";

describe("доступ к шагам урока", () => {
  it("открывает завершённые шаги и только первый незавершённый", () => {
    const steps = withLessonStepAccess([
      { id: "one", completedAt: new Date("2026-08-24T10:00:00Z") },
      { id: "two", completedAt: null },
      { id: "three", completedAt: null },
    ]);

    expect(steps.map((step) => step.unlocked)).toEqual([true, true, false]);
    expect(resolveAccessibleLessonStep(steps, "three")?.id).toBe("two");
    expect(resolveAccessibleLessonStep(steps, "one")?.id).toBe("one");
  });

  it("после завершения всех шагов разрешает свободную навигацию", () => {
    const steps = withLessonStepAccess([
      { id: "one", completedAt: new Date("2026-08-24T10:00:00Z") },
      { id: "two", completedAt: new Date("2026-08-24T10:05:00Z") },
      { id: "three", completedAt: new Date("2026-08-24T10:10:00Z") },
    ]);

    expect(steps.every((step) => step.unlocked)).toBe(true);
    expect(resolveAccessibleLessonStep(steps, "three")?.id).toBe("three");
  });
});
