import { describe, expect, it } from "vitest";
import { lessonDurationLabel } from "@/lib/utils/lesson-path";

const base = {
  readingMinutes: 8,
  textMinutes: null,
  videoMinutes: null,
  practiceMinutes: null,
  hasVideo: true,
} as const;

describe("lessonDurationLabel", () => {
  it("не выдаёт текстовую оценку за полную длительность видео+текст", () => {
    expect(lessonDurationLabel({ ...base, pathPolicy: "combined" })).toBe("видео + текст · 8 мин");
  });

  it("показывает альтернативу и ручные длительности", () => {
    expect(
      lessonDurationLabel({
        ...base,
        pathPolicy: "choose_one",
        textMinutes: 12,
        videoMinutes: 18,
        practiceMinutes: 20,
      }),
    ).toBe("на выбор: видео · 18 мин / текст · 12 мин + практика · 20 мин");
  });

  it("деградирует до текста, если видео для video_only не настроено", () => {
    expect(lessonDurationLabel({ ...base, pathPolicy: "video_only", hasVideo: false })).toBe(
      "текст · 8 мин",
    );
  });
});
