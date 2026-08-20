import type { LessonPathPolicy } from "@prisma/client";

export interface LessonDurationInput {
  readingMinutes: number;
  textMinutes: number | null;
  videoMinutes: number | null;
  practiceMinutes: number | null;
  pathPolicy: LessonPathPolicy;
  hasVideo: boolean;
  /**
   * Заход C.4: `false`, когда видео у урока ЕСТЬ, но плеера не будет — ссылка не
   * с YouTube рисуется карточкой «Открыть видео». Не задано — считаем, что плеер
   * будет (прежнее поведение вызывающих, которые про это ещё не знают).
   */
  videoPlayable?: boolean;
}

/**
 * Путь урока считается по ФАКТУ, а не по настройке (заход C.4).
 *
 * «Только видео» и «видео или текст» имеют смысл, пока видео способно ЗАМЕНИТЬ
 * текст, то есть пока на странице появляется плеер. Если видео — ссылка на чужой
 * домен (её нельзя встроить) или его нет вовсе, замены не происходит: ученик
 * оставался с пустым экраном, а в `choose_one` ещё и с записанным в БД выбором
 * «видео». Такой урок ведёт себя как «видео и текст подряд» — ссылка сверху,
 * текст под ней.
 *
 * Одна функция на всё: её читают и страница урока (что показывать), и подписи
 * длительности с меткой типа (что обещать) — иначе экран и подпись разошлись бы.
 */
export function effectivePathPolicy(
  pathPolicy: LessonPathPolicy,
  hasPlayer: boolean,
): LessonPathPolicy {
  if (hasPlayer) return pathPolicy;
  return pathPolicy === "video_only" || pathPolicy === "choose_one" ? "combined" : pathPolicy;
}

/** Появится ли на странице плеер: видео есть И оно встраиваемое. */
function hasPlayer(input: Pick<LessonDurationInput, "hasVideo" | "videoPlayable">): boolean {
  return input.hasVideo && input.videoPlayable !== false;
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
  switch (effectivePathPolicy(input.pathPolicy, hasPlayer(input))) {
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

/**
 * Числовая оценка урока в минутах — для сумм на странице курса («N мин всего»,
 * «Осталось ~N мин»), заход B.5. Подпись строкой по-прежнему делает
 * `lessonDurationLabel`: здесь нужна арифметика, там — честный текст.
 *
 * Правила совпадают с подписью, чтобы числа не спорили со строкой урока:
 *  • `video_only` — видео, а если его длина неизвестна, берём текст;
 *  • `text_only` — только текст;
 *  • `choose_one` — БОЛЬШИЙ из двух путей: ученик выбирает один, и занизить
 *    оценку хуже, чем завысить («осталось ~» не должно обманывать в меньшую);
 *  • `combined` — видео + текст.
 * Практика прибавляется всегда. Видео с неизвестной длительностью в сумму не
 * попадает — поэтому число на экране идёт с «~», а не как точное время.
 */
export function lessonTotalMinutes(input: LessonDurationInput): number {
  const text = input.textMinutes ?? Math.max(1, input.readingMinutes);
  const video = input.hasVideo ? (input.videoMinutes ?? 0) : 0;
  const practice = input.practiceMinutes ?? 0;

  let learning: number;
  switch (effectivePathPolicy(input.pathPolicy, hasPlayer(input))) {
    case "video_only":
      learning = video || text;
      break;
    case "text_only":
      learning = text;
      break;
    case "choose_one":
      learning = Math.max(text, video);
      break;
    case "combined":
    default:
      learning = text + video;
      break;
  }
  return learning + practice;
}

/**
 * Короткая метка типа урока для плашки программы (заход B.5, референс v2).
 * Референс красит видео акцентом `--violet`, поэтому вызывающему нужен не
 * только текст, но и признак «это видео».
 */
export function lessonKindLabel(
  input: Pick<LessonDurationInput, "pathPolicy" | "hasVideo" | "videoPlayable">,
): {
  label: string;
  isVideo: boolean;
} {
  if (!input.hasVideo) return { label: "текст", isVideo: false };
  switch (effectivePathPolicy(input.pathPolicy, hasPlayer(input))) {
    case "video_only":
      return { label: "видео", isVideo: true };
    case "text_only":
      // Видео есть, но путь урока — только текст: подпись не должна обещать видео.
      return { label: "текст", isVideo: false };
    case "choose_one":
      return { label: "видео или текст", isVideo: true };
    case "combined":
    default:
      return { label: "текст + видео", isVideo: true };
  }
}
