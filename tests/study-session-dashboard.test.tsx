import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudySessionDashboard } from "@/components/features/study-session-dashboard";
import { newStudyFields, type StudyCard } from "@/lib/utils/study-session-summary";

function studyCard(id: string, status: StudyCard["status"]): StudyCard {
  return {
    id,
    userId: "student-1",
    courseId: "course-1",
    lessonId: "lesson-1",
    courseTitle: "NLP Advanced",
    lessonTitle: "Attention",
    timezone: "Europe/Moscow",
    status,
    version: 2,
    fields: {
      ...newStudyFields(id === "active" ? "Механизм внимания" : "Трансформеры", "2026-09-05T19:30"),
      plannedBlocks: 2,
      blockMinutes: 25,
      explain: status === "completed" ? "yes" : null,
    },
    repetitions: [],
    plannedAt: "2026-09-05T16:30:00.000Z",
    startedAt: "2026-09-05T16:32:00.000Z",
    endedAt: status === "completed" ? "2026-09-05T17:22:00.000Z" : null,
    completedAt: status === "completed" ? "2026-09-05T17:24:00.000Z" : null,
    createdAt: "2026-09-05T16:20:00.000Z",
  };
}

describe("study sessions on dashboard", () => {
  it("shows the explanation, active timer, weekly metrics and recent mini-cards", () => {
    const html = renderToStaticMarkup(
      <StudySessionDashboard
        active={studyCard("active", "running")}
        summary={{
          count: 3,
          totalMinutes: 120,
          averageMinutes: 40,
          explain: { yes: 2, partial: 1, no: 0 },
        }}
        recent={[studyCard("recent", "completed")]}
      />,
    );
    for (const text of [
      "Что такое карточка занятия?",
      "реальный прогресс",
      "Сейчас идёт занятие",
      "Осталось 50:00",
      "3",
      "120 мин",
      "Трансформеры",
      "Объясню: да",
    ])
      expect(html).toContain(text);
    expect(html).toContain("/lessons/lesson-1#study-session-active");
    expect(html).toContain("/study-sessions#study-session-recent");
  });

  it("offers an honest first-card entry when there is no history", () => {
    const html = renderToStaticMarkup(
      <StudySessionDashboard
        active={null}
        summary={{
          count: 0,
          totalMinutes: 0,
          averageMinutes: null,
          explain: { yes: 0, partial: 0, no: 0 },
        }}
        recent={[]}
      />,
    );
    expect(html).toContain("Создать первую карточку занятия");
    expect(html).not.toContain("Последние занятия");
  });
});
