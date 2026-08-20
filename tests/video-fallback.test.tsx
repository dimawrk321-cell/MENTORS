import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoEmbed } from "@/components/blocks/video-embed";
import { LessonReader } from "@/components/features/lesson-reader";
import {
  effectivePathPolicy,
  lessonDurationLabel,
  lessonKindLabel,
  lessonTotalMinutes,
} from "@/lib/utils/lesson-path";
import { isPlayableVideoUrl } from "@/lib/utils/youtube";

// Заход C.4. Плеер платформы умеет один источник — YouTube; встроить Я.Диск
// нельзя (запрет на стороне Диска, не в нашей CSP). Проверяется честность
// поведения: ссылка не исчезает, текст урока не пропадает, подпись не обещает
// пути, которого нет.
//
// jsdom в проекте нет: рендер статический, поэтому здесь нет ни кликов, ни
// эффектов — проверяется РАЗМЕТКА первого кадра, то, что ученик увидит.

vi.mock("@/lib/actions/content", () => ({
  savePositionAction: async () => ({ ok: true }),
  selectLearningPathAction: async () => ({ ok: true }),
  startLessonAction: async () => ({ ok: true }),
}));

const YANDEX = "https://disk.yandex.ru/i/AbCdEf123456";
const YOUTUBE = "https://youtu.be/dQw4w9WgXcQ";

describe("VideoEmbed: ссылка, которую плеер не встраивает", () => {
  it("рисует карточку «Открыть видео» с названным источником вместо пустоты", () => {
    const html = renderToStaticMarkup(<VideoEmbed url={YANDEX} title="Разбор задачи" />);

    expect(html).toContain("Открыть видео");
    expect(html).toContain("disk.yandex.ru");
    expect(html).toContain("Разбор задачи");
    expect(html).toContain(`href="${YANDEX}"`);
    // Внешняя вкладка без передачи opener — то же правило, что у ссылок контента.
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
  });

  it("без названия карточка всё равно называет источник", () => {
    const html = renderToStaticMarkup(<VideoEmbed url={YANDEX} />);
    expect(html).toContain("Открыть видео");
    expect(html).toContain("disk.yandex.ru");
  });

  it("небезопасная схема не превращается в кнопку (аудит 13.2)", () => {
    const html = renderToStaticMarkup(<VideoEmbed url="javascript:alert(1)" title="Взлом" />);
    expect(html).toBe("");
    expect(html).not.toContain("javascript:");
  });

  it("пустой url по-прежнему не рисует ничего", () => {
    expect(renderToStaticMarkup(<VideoEmbed url="" />)).toBe("");
    expect(renderToStaticMarkup(<VideoEmbed />)).toBe("");
  });

  it("YouTube остаётся плеером с постером — регресс", () => {
    const html = renderToStaticMarkup(<VideoEmbed url={YOUTUBE} title="Лекция" />);
    expect(html).toContain("i.ytimg.com");
    expect(html).not.toContain("Открыть видео");
  });

  it("«видео недоступно» остаётся заглушкой, а не карточкой-ссылкой", () => {
    const html = renderToStaticMarkup(<VideoEmbed url={YANDEX} status="unavailable" />);
    expect(html).toContain("Видео временно недоступно");
    expect(html).not.toContain("Открыть видео");
  });
});

describe("блок :::video в тексте урока", () => {
  it("прогон через настоящий пайплайн даёт карточку, а не пустое место", async () => {
    const { renderLessonContent } = await import("@/components/blocks/lesson-renderer");
    const { content } = await renderLessonContent(
      `Текст урока.\n\n:::video{url="${YANDEX}" title="Лайфкодинг"}\n:::\n`,
    );
    const html = renderToStaticMarkup(<>{content}</>);

    expect(html).toContain("Открыть видео");
    expect(html).toContain("disk.yandex.ru");
    expect(html).toContain("Лайфкодинг");
  });
});

describe("isPlayableVideoUrl", () => {
  it("правда только про YouTube во всех его формах", () => {
    expect(isPlayableVideoUrl(YOUTUBE)).toBe(true);
    expect(isPlayableVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isPlayableVideoUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(true);
    expect(isPlayableVideoUrl(YANDEX)).toBe(false);
    expect(isPlayableVideoUrl("https://vk.com/video-1_2")).toBe(false);
    expect(isPlayableVideoUrl(null)).toBe(false);
    expect(isPlayableVideoUrl("")).toBe(false);
  });
});

describe("effectivePathPolicy: путь урока по факту, а не по настройке", () => {
  it("без плеера «только видео» и «на выбор» становятся «видео и текст»", () => {
    expect(effectivePathPolicy("video_only", false)).toBe("combined");
    expect(effectivePathPolicy("choose_one", false)).toBe("combined");
  });

  it("«только текст» и «видео и текст» не меняются никогда", () => {
    expect(effectivePathPolicy("text_only", false)).toBe("text_only");
    expect(effectivePathPolicy("combined", false)).toBe("combined");
  });

  it("с плеером настройка соблюдается дословно", () => {
    expect(effectivePathPolicy("video_only", true)).toBe("video_only");
    expect(effectivePathPolicy("choose_one", true)).toBe("choose_one");
  });
});

describe("подписи урока не обещают пути, которого нет", () => {
  const base = {
    readingMinutes: 6,
    textMinutes: 6,
    videoMinutes: 10,
    practiceMinutes: null,
    hasVideo: true,
  };

  it("«видео или текст» с невстраиваемой ссылкой читается как «текст + видео»", () => {
    expect(
      lessonKindLabel({ pathPolicy: "choose_one", hasVideo: true, videoPlayable: false }),
    ).toEqual({ label: "текст + видео", isVideo: true });
    // С плеером — прежняя формулировка.
    expect(lessonKindLabel({ pathPolicy: "choose_one", hasVideo: true }).label).toBe(
      "видео или текст",
    );
  });

  it("длительность складывает оба пути, раз показаны оба", () => {
    expect(lessonDurationLabel({ ...base, pathPolicy: "choose_one", videoPlayable: false })).toBe(
      "видео · 10 мин + текст · 6 мин",
    );
    expect(lessonDurationLabel({ ...base, pathPolicy: "video_only", videoPlayable: false })).toBe(
      "видео · 10 мин + текст · 6 мин",
    );
  });

  it("минуты считаются как у «видео и текст», а не как больший из путей", () => {
    expect(lessonTotalMinutes({ ...base, pathPolicy: "choose_one", videoPlayable: false })).toBe(
      16,
    );
    // С плеером «на выбор» берёт больший путь — прежнее правило захода B.5.
    expect(lessonTotalMinutes({ ...base, pathPolicy: "choose_one" })).toBe(10);
  });

  it("урок без видео ведёт себя как раньше", () => {
    expect(lessonDurationLabel({ ...base, pathPolicy: "video_only", hasVideo: false })).toBe(
      "текст · 6 мин",
    );
    expect(lessonKindLabel({ pathPolicy: "video_only", hasVideo: false })).toEqual({
      label: "текст",
      isVideo: false,
    });
  });
});

describe("страница урока: пустого экрана не остаётся", () => {
  function render(over: Partial<React.ComponentProps<typeof LessonReader>> = {}) {
    return renderToStaticMarkup(
      <LessonReader
        lessonId="l1"
        initialScrollPos={null}
        initialVideoPos={null}
        completed={false}
        impersonated={false}
        video={{ url: YANDEX, status: "unchecked", title: "Разбор" }}
        pathPolicy="video_only"
        initialSelectedPath={null}
        hasText
        {...over}
      >
        <article>ТЕЛО УРОКА</article>
      </LessonReader>,
    );
  }

  it("«только видео» + невстраиваемая ссылка: карточка И текст урока", () => {
    const html = render();
    expect(html).toContain("Открыть видео");
    expect(html).toContain("ТЕЛО УРОКА");
  });

  it("«на выбор» + невстраиваемая ссылка: выбора нет, показано и то и другое", () => {
    const html = render({ pathPolicy: "choose_one" });
    expect(html).not.toContain("Как пройти урок?");
    expect(html).toContain("Открыть видео");
    expect(html).toContain("ТЕЛО УРОКА");
  });

  it("«на выбор» + YouTube: выбор остаётся, текст под кнопкой — прежнее поведение", () => {
    const html = render({
      pathPolicy: "choose_one",
      video: { url: YOUTUBE, status: "ok", title: "Лекция" },
    });
    expect(html).toContain("Как пройти урок?");
    expect(html).not.toContain("ТЕЛО УРОКА");
  });

  it("«только видео» + недоступное видео: заглушка обещает текст — и текст есть", () => {
    const html = render({ video: { url: YOUTUBE, status: "unavailable", title: "Лекция" } });
    expect(html).toContain("Видео временно недоступно");
    expect(html).toContain("ТЕЛО УРОКА");
  });

  it("«только видео» + рабочий YouTube: текста нет — путь урока соблюдён", () => {
    const html = render({ video: { url: YOUTUBE, status: "ok", title: "Лекция" } });
    expect(html).toContain("i.ytimg.com");
    expect(html).not.toContain("ТЕЛО УРОКА");
  });
});
