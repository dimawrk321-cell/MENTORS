import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudyCardDetails } from "@/components/features/study-session-card";
import { newStudyFields, type StudyCard } from "@/lib/utils/study-session-summary";

describe("full study card", () => {
  it("keeps planning, actual facts, reflection and repetitions in one view", () => {
    const card: StudyCard = {
      id: "session-1",
      userId: "student-1",
      courseId: "course-1",
      lessonId: "lesson-1",
      courseTitle: "NLP Advanced",
      lessonTitle: "Attention",
      timezone: "Europe/Moscow",
      status: "completed",
      version: 4,
      fields: {
        ...newStudyFields("Механизм внимания", "2026-09-05T19:30"),
        goal: "объяснить Q, K и V",
        phoneAway: true,
        oneMaterial: true,
        timerSet: true,
        firstStepClear: true,
        blockPlan: "теория → практика",
        plannedBlocks: 2,
        blockMinutes: 25,
        startedOnTime: true,
        completedBlocks: 2,
        distractions: 1,
        explain: "partial",
        thoughts: ["Q — запрос", "K — ключ", "V — значение"],
        gaps: "маски",
        nextAction: "решить задачу",
      },
      repetitions: [
        {
          cardId: "srs-1",
          questionId: "q-1",
          step: 2,
          nextReviewAt: "2026-09-08",
          suspended: false,
        },
      ],
      plannedAt: "2026-09-05T16:30:00.000Z",
      startedAt: "2026-09-05T16:32:00.000Z",
      endedAt: "2026-09-05T17:22:00.000Z",
      completedAt: "2026-09-05T17:24:00.000Z",
      createdAt: "2026-09-05T16:20:00.000Z",
    };
    const html = renderToStaticMarkup(<StudyCardDetails card={card} editable />);
    for (const value of [
      "Механизм внимания",
      "2026-09-05T19:30",
      "объяснить Q, K и V",
      "теория → практика",
      "отвлечений: 1",
      "Q — запрос",
      "маски",
      "решить задачу",
      "R2",
      "2026-09-08",
      "NLP Advanced",
    ])
      expect(html).toContain(value);
    expect(html).toContain("/study-sessions?edit=session-1");
  });
});
