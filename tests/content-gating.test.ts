import { describe, expect, it } from "vitest";
import {
  computeCourseState,
  isLessonUpdatedSinceCompletion,
  type GatingModuleInput,
  type ProgressInput,
} from "@/lib/services/content";
import { computeReadingMinutes } from "@/lib/utils/markdown";

// Mandatory suite (spec 19.2): гейтинг во всех трёх режимах, optional-уроки,
// «урок обновлён», reading_minutes — pure logic, no DB.

const T0 = new Date("2026-07-01T00:00:00.000Z");
const T1 = new Date("2026-07-02T00:00:00.000Z");
const T2 = new Date("2026-07-03T00:00:00.000Z");

function lesson(id: string, isOptional = false, contentUpdatedAt: Date = T0) {
  return { id, isOptional, contentUpdatedAt };
}

function completed(at: Date = T1): ProgressInput {
  return { status: "completed", completedAt: at };
}

// Fixture: M1 = [L1 req, L2 optional, L3 req], M2 = [L4 req].
const MODULES: GatingModuleInput[] = [
  { id: "m1", lessons: [lesson("l1"), lesson("l2", true), lesson("l3")] },
  { id: "m2", lessons: [lesson("l4")] },
];

describe("strict gating (spec 7.3)", () => {
  it("initially only the first lesson slot is open; the first lesson is current", () => {
    const state = computeCourseState("strict", MODULES, new Map());
    expect(state.lessons.get("l1")).toMatchObject({ unlocked: true, current: true });
    expect(state.lessons.get("l2")?.unlocked).toBe(false);
    expect(state.lessons.get("l3")?.unlocked).toBe(false);
    expect(state.lessons.get("l4")?.unlocked).toBe(false);
    expect(state.nextLessonId).toBe("l1");
    expect(state.modules.get("m2")?.reachable).toBe(false);
  });

  it("completing a required lesson opens the next slot for both optional and required", () => {
    const state = computeCourseState("strict", MODULES, new Map([["l1", completed()]]));
    expect(state.lessons.get("l2")?.unlocked).toBe(true);
    // Optional l2 does not block l3 (spec: optional не блокируют прогрессию).
    expect(state.lessons.get("l3")?.unlocked).toBe(true);
    expect(state.lessons.get("l4")?.unlocked).toBe(false);
    expect(state.nextLessonId).toBe("l2");
  });

  it("module closes on required lessons only — optional may stay incomplete", () => {
    const progress = new Map([
      ["l1", completed()],
      ["l3", completed()],
    ]);
    const state = computeCourseState("strict", MODULES, progress);
    expect(state.modules.get("m1")?.closed).toBe(true);
    expect(state.modules.get("m2")?.reachable).toBe(true);
    expect(state.lessons.get("l4")?.unlocked).toBe(true);
    // Optional l2 is still the suggested next step.
    expect(state.nextLessonId).toBe("l2");
  });

  it("an incomplete required lesson keeps the module open and the next module locked", () => {
    const progress = new Map([
      ["l1", completed()],
      ["l2", completed()], // optional completed, required l3 is not
    ]);
    const state = computeCourseState("strict", MODULES, progress);
    expect(state.modules.get("m1")?.closed).toBe(false);
    expect(state.lessons.get("l4")?.unlocked).toBe(false);
  });

  it("module test hook participates in closing (stage-3 contract)", () => {
    const progress = new Map([
      ["l1", completed()],
      ["l3", completed()],
    ]);
    const state = computeCourseState("strict", MODULES, progress, () => false);
    expect(state.modules.get("m1")?.closed).toBe(false);
    expect(state.lessons.get("l4")?.unlocked).toBe(false);
  });

  it("required-lesson progress counters feed course progress", () => {
    const progress = new Map([["l1", completed()]]);
    const state = computeCourseState("strict", MODULES, progress);
    expect(state.completedRequired).toBe(1);
    expect(state.totalRequired).toBe(3); // l1, l3, l4 — optional l2 не в счёте
  });
});

describe("recommended and free gating (spec 7.3)", () => {
  for (const gating of ["recommended", "free"] as const) {
    it(`${gating}: everything is open, the order is still highlighted`, () => {
      const state = computeCourseState(gating, MODULES, new Map());
      for (const id of ["l1", "l2", "l3", "l4"]) {
        expect(state.lessons.get(id)?.unlocked).toBe(true);
      }
      expect(state.lessons.get("l1")?.current).toBe(true);
      expect(state.nextLessonId).toBe("l1");
    });
  }

  it("free: skipping ahead is allowed and current moves to the first uncompleted", () => {
    const state = computeCourseState("free", MODULES, new Map([["l4", completed()]]));
    expect(state.lessons.get("l4")).toMatchObject({ completed: true, unlocked: true });
    expect(state.nextLessonId).toBe("l1");
  });
});

describe("«урок обновлён» (spec 7.3)", () => {
  it("flags only lessons completed before the content change", () => {
    expect(isLessonUpdatedSinceCompletion(T1, T2)).toBe(true); // completed → updated after
    expect(isLessonUpdatedSinceCompletion(T2, T1)).toBe(false); // updated before completion
    expect(isLessonUpdatedSinceCompletion(null, T2)).toBe(false); // never completed
  });

  it("surfaces through course state", () => {
    const modules: GatingModuleInput[] = [
      { id: "m1", lessons: [lesson("l1", false, T2)] }, // content changed at T2
    ];
    const state = computeCourseState("strict", modules, new Map([["l1", completed(T1)]]));
    expect(state.lessons.get("l1")?.updatedSinceCompletion).toBe(true);
  });
});

describe("reading_minutes (spec 6: слова/180)", () => {
  it("counts words flat and rounds up", () => {
    expect(computeReadingMinutes(Array(180).fill("слово").join(" "))).toBe(1);
    expect(computeReadingMinutes(Array(181).fill("слово").join(" "))).toBe(2);
    expect(computeReadingMinutes(Array(540).fill("слово").join(" "))).toBe(3);
  });

  it("never returns less than a minute", () => {
    expect(computeReadingMinutes("")).toBe(1);
    expect(computeReadingMinutes("пара слов")).toBe(1);
  });
});
