import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb } from "./helpers/db";
import { saveLessonContent } from "@/lib/services/content-admin";
import { saveGuideContent } from "@/lib/services/guides";

// Заход C.4, блок 4. Правило 7.9 («запись — только через Библиотеку») не
// ослаблено: у ОПУБЛИКОВАННОГО материала сохранение по-прежнему отбивается, у
// черновика — проходит, а рендер вырезает ссылку и ставит врезку. Менялось
// одно: молчание. Теперь факт срабатывания санитайзера едет обратно в редактор,
// и ментор узнаёт о последствии в момент сохранения.

const UNSAFE = [
  "## Реальный лайфкодинг",
  "Смотри разбор:",
  "https://disk.yandex.ru/i/example",
  "Пароль: demo-123",
].join("\n");

const SAFE = "## Обычный урок\n\nТекст без ссылок на записи.";

async function makeLesson(status: "draft" | "published") {
  const course = await testDb.course.create({
    data: {
      slug: `c-${status}`,
      title: "C",
      status: "draft",
      modules: {
        create: [
          {
            title: "M",
            order: 0,
            status: "draft",
            lessons: {
              create: [{ slug: "l", title: "L", order: 0, status, contentMd: "Было" }],
            },
          },
        ],
      },
    },
    include: { modules: { include: { lessons: true } } },
  });
  return course.modules[0]!.lessons[0]!;
}

describe("санитайзер записей: ментор узнаёт при сохранении (заход C.4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("черновик сохраняется, но возвращает предупреждение", async () => {
    const lesson = await makeLesson("draft");
    const res = await saveLessonContent(testDb, { lessonId: lesson.id, contentMd: UNSAFE });

    expect(res).toMatchObject({ ok: true, recordingNotice: true });
    // Сохранено дословно: текст ментора не переписывается за его спиной —
    // вырезает ссылку рендер, а не хранилище.
    const stored = await testDb.lesson.findUnique({ where: { id: lesson.id } });
    expect(stored?.contentMd).toBe(UNSAFE);
  });

  it("чистый текст предупреждения не даёт", async () => {
    const lesson = await makeLesson("draft");
    const res = await saveLessonContent(testDb, { lessonId: lesson.id, contentMd: SAFE });
    expect(res).toMatchObject({ ok: true, recordingNotice: false });
  });

  it("у опубликованного урока сохранение по-прежнему отбивается", async () => {
    const lesson = await makeLesson("published");
    const res = await saveLessonContent(testDb, { lessonId: lesson.id, contentMd: UNSAFE });

    expect(res).toEqual({ ok: false, code: "unsafe_recording_reference" });
    const stored = await testDb.lesson.findUnique({ where: { id: lesson.id } });
    expect(stored?.contentMd).toBe("Было");
  });

  it("гайд-черновик ведёт себя так же", async () => {
    const guide = await testDb.guide.create({
      data: { slug: "g", section: "stages", title: "G", order: 0, status: "draft", contentMd: "x" },
    });

    expect(await saveGuideContent(testDb, { guideId: guide.id, contentMd: UNSAFE })).toMatchObject({
      ok: true,
      recordingNotice: true,
    });
    expect(await saveGuideContent(testDb, { guideId: guide.id, contentMd: SAFE })).toMatchObject({
      ok: true,
      recordingNotice: false,
    });
  });
});
