import { describe, it, expect, beforeEach } from "vitest";
import type { ContentStatus } from "@prisma/client";
import { testDb, resetDb } from "./helpers/db";
import { search, renderSnippet } from "@/lib/services/search";

// Stage 8 search service (spec 7.11 / 6 «FTS»): morphology, published filter,
// library_enabled gating, per-group limits, ranking, snippet escaping, and the
// trgm typo fallback. Runs against the real `mentors_test` DB (ru-RU ctype so
// pg_trgm handles Cyrillic — see tests/global-setup.ts).

let moduleId = "";
let categoryId = "";

async function seedContainers() {
  const course = await testDb.course.create({
    data: {
      slug: "c",
      title: "Курс",
      gating: "free",
      status: "published",
      modules: { create: [{ title: "Модуль", order: 0, status: "published" }] },
    },
    include: { modules: true },
  });
  moduleId = course.modules[0]!.id;
  const cat = await testDb.questionCategory.create({
    data: { title: "Classic ML", slug: "cml", colorIndex: 0, order: 0 },
  });
  categoryId = cat.id;
}

let lessonSeq = 0;
async function makeLesson(title: string, content: string, status: ContentStatus = "published") {
  lessonSeq += 1;
  return testDb.lesson.create({
    data: { moduleId, slug: `l${lessonSeq}`, title, order: lessonSeq, status, contentMd: content },
  });
}

async function makeQuestion(text: string, answer: string, status: ContentStatus = "published") {
  return testDb.question.create({
    data: { type: "open", categoryId, textMd: text, answerMd: answer, status, difficulty: 1 },
  });
}

async function makeGuide(title: string, content: string, status: ContentStatus = "published") {
  return testDb.guide.create({
    data: {
      slug: `g-${title}-${Math.round(Math.random() * 1e6)}`
        .toLowerCase()
        .replace(/[^a-zа-я0-9]+/gi, "-"),
      section: "tools",
      title,
      order: 0,
      contentMd: content,
      status,
    },
  });
}

async function makeRecording(title: string, status: ContentStatus = "published") {
  return testDb.recording.create({
    data: {
      title,
      stage: "theory",
      direction: "nlp",
      grade: "middle",
      outcome: "offer",
      companyType: "bigtech",
      durationMinutes: 60,
      url: "https://disk.yandex/x",
      checklist: { faces: true, voice: true, names: true, consent: true },
      status,
    },
  });
}

/** Does this DB's pg_trgm handle Cyrillic? (C-locale DBs extract no trigrams.) */
async function trgmHandlesCyrillic(): Promise<boolean> {
  const r = await testDb.$queryRawUnsafe<{ s: number }[]>(
    `SELECT similarity('регуляризация','регуляризацие') s`,
  );
  return (r[0]?.s ?? 0) > 0;
}

describe("search — FTS morphology & filters (spec 7.11)", () => {
  beforeEach(async () => {
    await resetDb();
    lessonSeq = 0;
    await seedContainers();
  });

  it("matches Russian morphology: «регуляризация» finds «регуляризации»", async () => {
    await makeLesson("Обучение", "Здесь мы применяем регуляризации к модели для устойчивости.");
    const res = await search(testDb, { q: "регуляризация", libraryEnabled: true });
    const lessons = res.groups.find((g) => g.type === "lessons");
    expect(lessons?.items.length).toBe(1);
    expect(res.fuzzy).toBe(false);
  });

  it("searches all four entity types via websearch_to_tsquery", async () => {
    await makeLesson("Трансформеры", "Механизм внимания в трансформерах.");
    await makeQuestion("Что такое трансформер?", "Архитектура на внимании.");
    await makeGuide("Трансформеры на практике", "Гайд по трансформерам.");
    await makeRecording("Собеседование про трансформеры");
    const res = await search(testDb, { q: "трансформер", libraryEnabled: true });
    expect(res.groups.map((g) => g.type).sort()).toEqual([
      "guides",
      "lessons",
      "questions",
      "recordings",
    ]);
  });

  it("returns only published entities", async () => {
    await makeLesson("Градиентный спуск", "оптимизация градиентным спуском", "draft");
    await makeQuestion("Что такое градиент?", "производная", "draft");
    await makeGuide("Градиенты", "про градиенты", "draft");
    const res = await search(testDb, { q: "градиент", libraryEnabled: true });
    expect(res.groups.length).toBe(0);
  });

  it("includes recordings only when library_enabled", async () => {
    await makeRecording("Мок про эмбеддинги");
    const withLib = await search(testDb, { q: "эмбеддинги", libraryEnabled: true });
    expect(withLib.groups.some((g) => g.type === "recordings")).toBe(true);
    const noLib = await search(testDb, { q: "эмбеддинги", libraryEnabled: false });
    expect(noLib.groups.some((g) => g.type === "recordings")).toBe(false);
  });

  it("caps each group at 5 items", async () => {
    for (let i = 0; i < 7; i += 1) {
      await makeLesson(`Урок про кластеризацию ${i}`, "кластеризация данных методом k-means");
    }
    const res = await search(testDb, { q: "кластеризация", libraryEnabled: true });
    const lessons = res.groups.find((g) => g.type === "lessons");
    expect(lessons?.items.length).toBe(5);
  });

  it("ranks a title match above a body-only match (weighted tsvector)", async () => {
    await makeLesson("Введение", "мимоходом упоминаем валидацию где-то в тексте урока");
    await makeLesson("Валидация моделей", "как правильно делить выборку");
    const res = await search(testDb, { q: "валидация", libraryEnabled: true });
    const lessons = res.groups.find((g) => g.type === "lessons");
    expect(lessons?.items[0]!.title).toBe("Валидация моделей");
  });

  it("builds correct urls and meta per type", async () => {
    const guide = await makeGuide("Резюме", "как писать резюме");
    const res = await search(testDb, { q: "резюме", libraryEnabled: true });
    const item = res.groups.find((g) => g.type === "guides")!.items[0]!;
    expect(item.url).toBe(`/guides/${guide.slug}`);
    expect(item.meta).toBe("Инструменты индустрии");
  });
});

describe("search — snippet escaping (spec 7.11)", () => {
  beforeEach(async () => {
    await resetDb();
    lessonSeq = 0;
    await seedContainers();
  });

  it("renderSnippet escapes content and reveals only <mark>", () => {
    const raw = "<b>bold</b> hit <script>x</script>";
    const html = renderSnippet(raw);
    expect(html).toContain("<mark>hit</mark>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
  });

  it("never emits raw HTML from lesson content in a snippet", async () => {
    await makeLesson("Безопасность", "перед словом дропаут стоит <img src=x onerror=alert(1)> тег");
    const res = await search(testDb, { q: "дропаут", libraryEnabled: true });
    const snippet = res.groups.find((g) => g.type === "lessons")!.items[0]!.snippet;
    // Only <mark> tags may appear — any other tag would be an XSS hole.
    expect(snippet).not.toMatch(/<(?!\/?mark>)[^>]*>/);
    expect(snippet).toContain("&lt;img");
  });
});

describe("search — trgm typo fallback (spec 7.11)", () => {
  beforeEach(async () => {
    await resetDb();
    lessonSeq = 0;
    await seedContainers();
  });

  it("falls back to a fuzzy title match when FTS is empty", async () => {
    if (!(await trgmHandlesCyrillic())) {
      // C-locale DB: pg_trgm can't tokenize Cyrillic — fallback is a no-op here.
      return;
    }
    await makeLesson("Регуляризация", "L1 и L2 регуляризация");
    // A ROOT misspelling (р→ж), not a suffix: the russian stemmer can't normalise
    // it to the same lexeme, so FTS misses — but it stays trgm-close to the title.
    const res = await search(testDb, { q: "регуляжизация", libraryEnabled: true });
    expect(res.fuzzy).toBe(true);
    expect(res.groups.find((g) => g.type === "lessons")?.items.length).toBe(1);
  });

  it("returns empty (not fuzzy) when nothing is even close", async () => {
    await makeLesson("Регуляризация", "текст");
    const res = await search(testDb, { q: "zzqwmnbvx", libraryEnabled: true });
    expect(res.groups.length).toBe(0);
    expect(res.fuzzy).toBe(false);
  });
});
