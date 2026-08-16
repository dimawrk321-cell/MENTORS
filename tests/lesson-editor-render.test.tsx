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
  saveLessonContentAction: async () => ({ ok: true, data: { readingMinutes: 7 } }),
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
  it("автооценка подсказана в поле, а не спрятана", () => {
    const html = render({ status: "draft", readingMinutes: 7 });
    expect(html).toContain("Автоматически: 7");
    // И показано, что из этого увидит ученик.
    expect(html).toContain("Ученик увидит:");
    expect(html).toContain("текст · 7 мин");
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
  });
});
