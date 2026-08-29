import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonEditor } from "@/app/(admin)/admin/content/lessons/[id]/lesson-editor";

// Заход B.2, блок 3. Жалоба ментора: «не понимаю, как опубликовать урок».
// Проверяется ТЕКСТ и СОСТАВ панели действий — то, на что смотрит человек.
// jsdom в проекте нет: рендер статический, поэтому здесь нет ни кликов, ни
// раскладки (их проверяют в браузере).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
}));
vi.mock("@/lib/actions/content-admin", () => ({
  saveLessonContentAction: async () => ({
    ok: true,
    data: { readingMinutes: 7, lessonReadingMinutes: 7 },
  }),
  saveLessonStepContentAction: async () => ({
    ok: true,
    data: { readingMinutes: 2, lessonReadingMinutes: 7 },
  }),
  setLessonStatusAction: async () => ({ ok: true }),
  updateLessonMetaAction: async () => ({ ok: true }),
}));
vi.mock("@/lib/actions/questions-admin", () => ({
  lookupQuizQuestionAction: async () => ({ ok: true, data: null }),
  searchQuizQuestionsAction: async () => ({ ok: true, data: [] }),
}));

const BASE: {
  id: string;
  title: string;
  slug: string;
  contentMd: string;
  videoUrl: string;
  difficulty: "intro" | "base" | "advanced";
  isOptional: boolean;
  readingMinutes: number;
  pathPolicy: "combined" | "choose_one" | "video_only" | "text_only";
  textMinutes: number | null;
  videoMinutes: number | null;
  practiceMinutes: number | null;
} = {
  id: "l1",
  title: "Урок про метрики",
  slug: "metriki",
  contentMd: "Текст урока.\n",
  videoUrl: "",
  difficulty: "base",
  isOptional: false,
  readingMinutes: 7,
  pathPolicy: "combined",
  textMinutes: null,
  videoMinutes: null,
  practiceMinutes: null,
};

function render(overrides: Partial<typeof BASE> & { status: "draft" | "published" }): string {
  return renderToStaticMarkup(
    <LessonEditor lesson={{ ...BASE, ...overrides }} courseTitle="Курс" moduleTitle="Модуль" />,
  );
}

describe("панель действий редактора", () => {
  it("состояние черновика читается словами, а не только цветом бейджа", () => {
    const html = render({ status: "draft" });
    expect(html).toContain("Черновик");
    expect(html).toContain("Ученики его не видят");
    expect(html).toContain("Опубликовать");
  });

  it("у опубликованного урока — обратное действие и честная подпись", () => {
    const html = render({ status: "published" });
    expect(html).toContain("Опубликован");
    expect(html).toContain("Ученики видят этот урок");
    expect(html).toContain("Снять с публикации");
  });

  it("сохранение видно кнопкой, а не только автосейвом", () => {
    expect(render({ status: "draft" })).toContain("Сохранено");
  });
});

describe("время урока", () => {
  it("показывает единый редактор и автооценку всего урока", () => {
    const html = render({ status: "draft", readingMinutes: 7 });
    expect(html).toContain("Время урока");
    expect(html).toContain("По объёму всего урока: 7 мин");
    expect(html).toContain("Расчётный итог");
    expect(html).toContain("~7 мин");
    expect(html).toContain("Ученик увидит:");
    expect(html).toContain("текст · 7 мин");
  });

  it("не выдаёт минуты открытого шага за время всего урока", () => {
    const html = renderToStaticMarkup(
      <LessonEditor
        lesson={{ ...BASE, status: "published", readingMinutes: 9 }}
        activeStep={{
          id: "s1",
          title: "Введение",
          contentMd: "Короткий шаг",
          readingMinutes: 2,
          status: "published",
        }}
        courseTitle="Курс"
        moduleTitle="Модуль"
      />,
    );
    expect(html).toContain("Текущий шаг: 2 мин");
    expect(html).toContain("весь урок: ~9 мин");
    expect(html).toContain("По объёму всего урока: 9 мин");
  });

  it("объясняет, что черновой шаг ещё не входит в ученический итог", () => {
    const html = renderToStaticMarkup(
      <LessonEditor
        lesson={{ ...BASE, status: "draft", readingMinutes: 7 }}
        activeStep={{
          id: "s1",
          title: "Черновик",
          contentMd: "Новый материал",
          readingMinutes: 2,
          status: "draft",
        }}
        courseTitle="Курс"
        moduleTitle="Модуль"
      />,
    );
    expect(html).toContain("его текст не входит во время урока до публикации");
  });

  it("ручное значение перебивает автооценку в предпросмотре", () => {
    const html = render({ status: "draft", readingMinutes: 7, textMinutes: 25 });
    expect(html).toContain("текст · 25 мин");
  });

  it("видео и практика попадают в ту же строку", () => {
    const html = render({
      status: "draft",
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      videoMinutes: 12,
      practiceMinutes: 30,
    });
    expect(html).toContain("видео · 12 мин");
    expect(html).toContain("практика · 30 мин");
    expect(html).toContain("~49 мин");
  });
});
