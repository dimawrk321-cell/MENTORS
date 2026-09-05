import { describe, expect, it } from "vitest";
import {
  newStudyFields,
  normalizeStudyText,
  studyFlags,
  summarizeStudyWeek,
  type StudyCard,
} from "@/lib/utils/study-session-summary";

function card(
  id: string,
  endedAt: string,
  patch: Partial<ReturnType<typeof newStudyFields>> = {},
): StudyCard {
  return {
    id,
    userId: "u",
    courseId: "c",
    lessonId: "l",
    courseTitle: "Курс",
    lessonTitle: "Урок",
    timezone: "Europe/Moscow",
    status: "completed",
    version: 1,
    fields: {
      ...newStudyFields("Attention", "2026-09-01T19:00"),
      startedOnTime: true,
      completedBlocks: 2,
      distractions: 0,
      explain: "yes",
      thoughts: ["a", "b", "c"],
      gaps: "",
      nextAction: "Повторить",
      ...patch,
    },
    repetitions: [],
    plannedAt: "2026-09-01T16:00:00.000Z",
    startedAt: new Date(Date.parse(endedAt) - 30 * 60000).toISOString(),
    endedAt,
    completedAt: endedAt,
    createdAt: endedAt,
  };
}
describe("study session summary", () => {
  it("aggregates a local Monday week and preserves zero values", () => {
    const cards = [
      card("a", "2026-09-01T17:00:00.000Z"),
      card("b", "2026-09-02T17:00:00.000Z", {
        distractions: 2,
        explain: "partial",
        gaps: "KV-cache",
      }),
      card("c", "2026-09-03T17:00:00.000Z", { distractions: 1, explain: "no", gaps: "kv cache" }),
    ];
    const result = summarizeStudyWeek(cards, new Date("2026-09-05T12:00:00Z"), "Europe/Moscow");
    expect(result.week).toBe("2026-08-31");
    expect(result.count).toBe(3);
    expect(result.totalMinutes).toBe(90);
    expect(result.averageDistractions).toBe(1);
    expect(result.explain).toEqual({ yes: 1, partial: 1, no: 1 });
    expect(result.gaps[0]?.sessionIds).toEqual(["b", "c"]);
  });
  it("returns honest empties", () => {
    const result = summarizeStudyWeek([], new Date("2026-09-05T12:00:00Z"), "Asia/Yekaterinburg");
    expect(result).toMatchObject({
      count: 0,
      totalMinutes: 0,
      averageMinutes: null,
      averageDistractions: null,
      topics: [],
      gaps: [],
    });
  });
  it("normalizes Russian spelling and punctuation deterministically", () =>
    expect(normalizeStudyText("  Всё: про KV-cache! ")).toBe("все про kv cache"));
});
describe("study session flags", () => {
  it("explains consecutive no and high-distraction runs", () => {
    const cards = ["01", "02", "03", "04"].map((d, i) =>
      card(String(i), `2026-09-${d}T17:00:00Z`, { explain: i > 0 ? "no" : "yes", distractions: 4 }),
    );
    const flags = studyFlags(
      cards,
      new Date("2026-09-05T12:00:00Z"),
      "Europe/Moscow",
      new Date("2026-09-04T17:00:00Z"),
    );
    expect(flags.find((f) => f.type === "explain")?.sessionIds).toHaveLength(3);
    expect(flags.find((f) => f.type === "distractions")?.severity).toBe("red");
  });
  it("flags repeated exact-normalized gaps and five inactive local days", () => {
    const cards = ["01", "02", "03"].map((d, i) =>
      card(String(i), `2026-08-${d}T12:00:00Z`, {
        gaps: i === 1 ? "Градиентный спуск!" : "градиентный спуск",
      }),
    );
    const flags = studyFlags(
      cards,
      new Date("2026-08-10T12:00:00Z"),
      "Europe/Moscow",
      new Date("2026-08-03T12:00:00Z"),
    );
    expect(flags.some((f) => f.type.startsWith("gap:"))).toBe(true);
    expect(flags.find((f) => f.type === "inactive")?.reason).toContain("7 дней");
  });
});
