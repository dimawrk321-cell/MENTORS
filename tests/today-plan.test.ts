import { describe, expect, it } from "vitest";
import { buildTodayPlan } from "@/lib/utils/today-plan";

const NOW = new Date("2026-08-23T09:00:00.000Z").getTime();

describe("«Что делать сегодня»", () => {
  const base = {
    nowMs: NOW,
    queue: { total: 12, estimateMinutes: 5 },
    lesson: { id: "lesson-1", title: "Метрики", mode: "continue" as const },
    weak: { categoryId: "cat-1", title: "Classic ML", againShare: 0.42 },
  };

  it("ставит мок в ближайшие 24 часа выше очереди и урока", () => {
    const plan = buildTodayPlan({
      ...base,
      mock: {
        bookingId: "mock-1",
        startsAtMs: NOW + 60 * 60 * 1000,
        endsAtMs: NOW + 2 * 60 * 60 * 1000,
        whenLabel: "сегодня, 13:00",
      },
    });

    expect(plan.primary.kind).toBe("mock");
    expect(plan.secondary.map((item) => item.kind)).toEqual(["srs", "lesson"]);
  });

  it("без близкого мока главным шагом делает дневную очередь", () => {
    const plan = buildTodayPlan({
      ...base,
      mock: {
        bookingId: "later",
        startsAtMs: NOW + 30 * 60 * 60 * 1000,
        endsAtMs: NOW + 31 * 60 * 60 * 1000,
        whenLabel: "послезавтра",
      },
    });

    expect(plan.primary).toMatchObject({ kind: "srs", href: "/trainer/session" });
  });

  it("после очереди предлагает урок, затем слабую тему с целевым прогоном", () => {
    const plan = buildTodayPlan({ ...base, queue: null });

    expect(plan.primary.kind).toBe("lesson");
    expect(plan.secondary[0]).toMatchObject({
      kind: "weak",
      href: "/trainer/free/run?source=category&id=cat-1&size=15",
    });
  });

  it("при отсутствии учебных сигналов ведёт в каталог курсов", () => {
    const plan = buildTodayPlan({ nowMs: NOW });
    expect(plan.primary).toMatchObject({ kind: "courses", href: "/courses" });
    expect(plan.secondary).toEqual([]);
  });
});
