import type { LessonPathPolicy } from "@prisma/client";

export interface LessonDurationInput {
  readingMinutes: number;
  textMinutes: number | null;
  videoMinutes: number | null;
  practiceMinutes: number | null;
  pathPolicy: LessonPathPolicy;
  hasVideo: boolean;
}

/**
 * Student-facing duration label. It deliberately avoids a single «total» when
 * video length is unknown and names readingMinutes as text time: external tasks
 * and a video must not be hidden inside a misleading number.
 */
export function lessonDurationLabel(input: LessonDurationInput): string {
  const textMinutes = input.textMinutes ?? Math.max(1, input.readingMinutes);
  const text = `текст · ${textMinutes} мин`;
  const video = input.hasVideo
    ? input.videoMinutes
      ? `видео · ${input.videoMinutes} мин`
      : "видео"
    : null;
  const practice = input.practiceMinutes ? `практика · ${input.practiceMinutes} мин` : null;

  let learning: string;
  switch (input.pathPolicy) {
    case "video_only":
      learning = video ?? text;
      break;
    case "text_only":
      learning = text;
      break;
    case "choose_one":
      learning = video ? `на выбор: ${video} / ${text}` : text;
      break;
    case "combined":
    default:
      learning = [video, text].filter(Boolean).join(" + ");
      break;
  }

  return practice ? `${learning} + ${practice}` : learning;
}
