import { describe, it, expect } from "vitest";
import { parseNotionExport, dedent, nodeBody } from "@/lib/services/notion-import/parser";
import {
  convertLessonBody,
  convertQuestionAnswer,
  extractOptional,
  canonicalYouTube,
} from "@/lib/services/notion-import/content";
import { matchCategoryName, matchSeedRoot } from "@/lib/services/notion-import/categories";
import { normalizeImageName, createImageResolver } from "@/lib/services/notion-import/images";
import { buildImportPlan } from "@/lib/services/notion-import/plan";

// Pure unit tests for the Notion importer (spec 7.14). No DB — the plan builder
// and all transforms are exercised on inline fixtures.

// A miniature export mirroring the real one: 2-space indent steps, an extra
// «Техническое собеседование» stage above the seed categories, an image-only
// answer, a split NLP track, a mock soft-skills lesson and skipped sections.
const FIXTURE = [
  "# База",
  "",
  "- **Спринты (основное обучение)**",
  "  - **Python + PyTorch**",
  "    - **Базовый синтаксис**",
  "",
  "      **Практика** (модуль X):",
  "",
  "      - Переменные",
  "      - Условия",
  "",
  "      **Категории вопросов для заучивания в базе:** Списки; Выдуманная категория",
  "",
  "      **Проверка себя:** объясни, почему список изменяемый.",
  "    - **Визуализация (ДОПОЛНИТЕЛЬНО ПРИ ЖЕЛАНИИ)**",
  "",
  "      ### 🎬 Видео",
  "",
  "      🔗 [https://www.youtube.com/watch?v=aaaaaaaaaaa](https://www.youtube.com/watch?v=aaaaaaaaaaa)",
  "",
  "      Второе видео:",
  "",
  "      [https://youtu.be/bbbbbbbbbbb](https://youtu.be/bbbbbbbbbbb)",
  "  - **NLP**",
  "    ## **Простая мапа**",
  "    - **Введение**",
  "",
  "      Тело урока.",
  "    ## **ШАД**",
  "    - **L1 Эмбеддинги**",
  "",
  "      Тело L1.",
  "  - **Soft skills**",
  "    - **Первый mock**",
  "",
  "      Контент мока.",
  "  - **Основные инструменты, используемые на работе**",
  "    - **Git**",
  "- **Вопросы с собеседований**",
  "  - **Техническое собеседование**",
  "    - **Python**",
  "      - **Списки**",
  "        - **Что такое список?**",
  "",
  "          Список — изменяемая коллекция.",
  "        - **Как отсортировать список?**",
  "",
  "          ![img.png](img.png)",
  "      - **Как выглядит GIL в деталях**",
  "",
  "        Ответ про GIL без подвопросов.",
  "  - **Скрининг**",
  "    - **Мотивация**",
  "      - **Почему ищете работу?**",
  "",
  "        Ответ про мотивацию.",
  "- **Гайды по резюме и легенде**",
  "  - **Резюме**",
  "- **Собеседования**",
].join("\n");

function plan() {
  return buildImportPlan(FIXTURE, new Set(["img.png"]));
}

describe("parseNotionExport — tree by indentation", () => {
  it("builds the section→track→lesson tree from 2-space steps", () => {
    const doc = parseNotionExport(FIXTURE);
    const sections = doc.roots.map((n) => n.title);
    expect(sections).toContain("Спринты (основное обучение)");
    expect(sections).toContain("Вопросы с собеседований");

    const sprints = doc.roots.find((n) => n.title.startsWith("Спринты"))!;
    const tracks = sprints.children.filter((c) => c.kind === "bullet").map((c) => c.title);
    expect(tracks).toEqual([
      "Python + PyTorch",
      "NLP",
      "Soft skills",
      "Основные инструменты, используемые на работе",
    ]);

    const python = sprints.children.find((c) => c.title === "Python + PyTorch")!;
    expect(python.children.map((c) => c.title)).toEqual([
      "Базовый синтаксис",
      "Визуализация (ДОПОЛНИТЕЛЬНО ПРИ ЖЕЛАНИИ)",
    ]);
  });

  it("captures module headings as separate boundary nodes inside a track", () => {
    const doc = parseNotionExport(FIXTURE);
    const nlp = doc.roots
      .find((n) => n.title.startsWith("Спринты"))!
      .children.find((c) => c.title === "NLP")!;
    const headings = nlp.children.filter((c) => c.kind === "module-heading").map((c) => c.title);
    expect(headings).toEqual(["Простая мапа", "ШАД"]);
  });

  it("dedents a body block and slices the whole subtree of a leaf", () => {
    expect(dedent(["    a", "      b", "", "    c"])).toBe("a\n  b\n\nc");
    const doc = parseNotionExport(FIXTURE);
    const q = doc.roots.find((n) => n.title.startsWith("Вопросы"))!.children[0]!.children[0]!
      .children[0]!.children[0]!; // Что такое список?
    expect(q.title).toBe("Что такое список?");
    expect(nodeBody(doc, q)).toBe("Список — изменяемая коллекция.");
  });
});

describe("content conversion (spec 7.14 п.4)", () => {
  const resolver = () => createImageResolver(new Set(["img.png"]));

  it("extracts the first YouTube as video_url and the rest as :::video", () => {
    const body = [
      "### 🎬 Видео",
      "",
      "🔗 [x](https://www.youtube.com/watch?v=aaaaaaaaaaa)",
      "",
      "[y](https://youtu.be/bbbbbbbbbbb)",
    ].join("\n");
    const out = convertLessonBody(body, resolver());
    expect(out.videoUrl).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    expect(out.contentMd).toContain(':::video{url="https://www.youtube.com/watch?v=bbbbbbbbbbb"}');
    expect(out.contentMd).not.toContain("aaaaaaaaaaa"); // first video pulled to header
    expect(out.contentMd).toContain("### Видео"); // 🎬 stripped
  });

  it("wraps Практика and extracts «Проверка себя» / «Категории…»", () => {
    const body = [
      "**Практика** (модуль):",
      "",
      "- Один",
      "- Два",
      "",
      "**Категории вопросов для заучивания в базе:** Списки; Словари",
      "",
      "**Проверка себя:** объясни X.",
    ].join("\n");
    const out = convertLessonBody(body, resolver());
    expect(out.contentMd).toContain(":::practice");
    expect(out.keyQuestions).toEqual(["объясни X."]);
    expect(out.categoryLinkNames).toEqual(["Списки", "Словари"]);
    expect(out.contentMd).not.toContain("Проверка себя");
  });

  it("flags an image-only answer as needs_latex and rewrites the path", () => {
    const out = convertQuestionAnswer("![img.png](img.png)", resolver());
    expect(out.needsLatex).toBe(true);
    expect(out.answerMd).toBe("![img.png](/media/import/img.png)");
  });

  it("keeps a text answer (with a table) and does not flag needs_latex", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const out = convertQuestionAnswer(table, resolver());
    expect(out.needsLatex).toBe(false);
    expect(out.answerMd).toContain("| --- |");
  });

  it("extracts the «ДОПОЛНИТЕЛЬНО» tag into is_optional", () => {
    expect(extractOptional("Визуализация (ДОПОЛНИТЕЛЬНО ПРИ ЖЕЛАНИИ)")).toEqual({
      title: "Визуализация",
      isOptional: true,
    });
    expect(extractOptional("Обычный урок")).toEqual({ title: "Обычный урок", isOptional: false });
  });

  it("canonicalizes YouTube links, ignoring extra params", () => {
    expect(canonicalYouTube("https://www.youtube.com/watch?v=abcdefghijk&list=X")).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    expect(canonicalYouTube("https://youtu.be/abcdefghijk?t=3")).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    expect(canonicalYouTube("https://habr.com/x")).toBeNull();
  });
});

describe("category matching (spec 7.14 п.4/п.5)", () => {
  it("maps «АБ тесты и статистика» to the seed «А/Б-тесты и статистика»", () => {
    expect(matchSeedRoot("АБ тесты и статистика")?.title).toBe("А/Б-тесты и статистика");
    expect(matchSeedRoot("classic ml")?.title).toBe("Classic ML");
    expect(matchSeedRoot("Совершенно другое")).toBeNull();
  });

  it("resolves a parenthetical qualifier and a prefix (GIL)", () => {
    const cats = [{ title: "GIL (глобальная блокировка интерпретатора)" }, { title: "Словари" }];
    expect(matchCategoryName("GIL", cats)?.title).toBe(
      "GIL (глобальная блокировка интерпретатора)",
    );
    expect(
      matchCategoryName("ООП в Python (self, инкапсуляция)", [{ title: "ООП в Python" }])?.title,
    ).toBe("ООП в Python");
  });

  it("normalizes image names to ASCII", () => {
    expect(normalizeImageName("image 1.png")).toBe("image-1.png");
    expect(normalizeImageName("image.png")).toBe("image.png");
    expect(normalizeImageName("Формула Λ.PNG")).toMatch(/\.png$/);
  });
});

describe("buildImportPlan — mapping & heuristics (spec 7.14)", () => {
  it("produces the expected courses and routes guide sections (spec 7.14 part 2)", () => {
    const p = plan();
    const slugs = p.courses.map((c) => c.slug);
    expect(slugs).toEqual(["python-pytorch", "nlp-basic", "nlp-advanced", "soft-skills"]);
    // «Основные инструменты» → guides(tools), no longer skipped (part 2).
    expect(p.guides.some((g) => g.section === "tools" && g.title === "Git")).toBe(true);
    expect(p.anomalies.skippedSections.map((s) => s.title)).not.toContain(
      "Основные инструменты, используемые на работе",
    );
    // Guide sections are routed to guides, not skipped.
    expect(p.anomalies.skippedSections.map((s) => s.title)).not.toContain(
      "Гайды по резюме и легенде",
    );
    // Only the Я.Диск «Собеседования» section is skipped now.
    expect(p.anomalies.skippedSections.map((s) => s.title)).toContain("Собеседования");
  });

  it("splits NLP into базовый/продвинутый by the module headings", () => {
    const p = plan();
    const basic = p.courses.find((c) => c.slug === "nlp-basic")!;
    const advanced = p.courses.find((c) => c.slug === "nlp-advanced")!;
    expect(basic.modules[0]!.lessons.map((l) => l.title)).toEqual(["Введение"]);
    expect(advanced.modules[0]!.lessons.map((l) => l.title)).toEqual(["L1 Эмбеддинги"]);
  });

  it("marks the optional lesson and gives the mock lesson a :::mock CTA", () => {
    const p = plan();
    const python = p.courses.find((c) => c.slug === "python-pytorch")!;
    const optional = python.modules[0]!.lessons.find((l) => l.title === "Визуализация")!;
    expect(optional.isOptional).toBe(true);
    expect(optional.videoUrl).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa");

    const mock = p.courses
      .find((c) => c.slug === "soft-skills")!
      .modules[0]!.lessons.find((l) => /mock/i.test(l.title))!;
    expect(mock.contentMd.startsWith(':::mock{type="legend"}')).toBe(true);
  });

  it("attaches «Проверка себя» as a key question and resolves category links", () => {
    const p = plan();
    const lesson = p.courses
      .find((c) => c.slug === "python-pytorch")!
      .modules[0]!.lessons.find((l) => l.title === "Базовый синтаксис")!;
    expect(lesson.keyQuestions).toHaveLength(1);
    expect(lesson.keyQuestions[0]!.categoryTitle).toBe("Python");
    // «Списки» resolves to the imported subcategory; the made-up one is reported.
    expect(lesson.categoryLinkSlugs.length).toBe(1);
    expect(p.anomalies.unrecognizedCategoryLinks.map((u) => u.name)).toContain(
      "Выдуманная категория",
    );
  });

  it("matches seed roots through the transparent stage; creates non-seed roots", () => {
    const p = plan();
    const roots = p.categories.filter((c) => !c.parentTitle).map((c) => c.title);
    expect(roots).toContain("Python"); // seed, matched a level below «Техническое собеседование»
    expect(roots).toContain("Скрининг"); // non-seed root created
    expect(p.anomalies.createdNonSeedRootCategories.map((c) => c.title)).toContain("Скрининг");
  });

  it("applies the question-vs-subcategory heuristic (spec 7.14 п.5)", () => {
    const p = plan();
    // «Списки» is a subcategory (has «?» children); its two questions are imported.
    const subQuestions = p.questions.filter((q) => q.subCategoryTitle === "Списки");
    expect(subQuestions.map((q) => q.textMd).sort()).toEqual([
      "Как отсортировать список?",
      "Что такое список?",
    ]);
    // The image-only answer is flagged needs_latex and rewritten.
    const sorted = subQuestions.find((q) => q.textMd === "Как отсортировать список?")!;
    expect(sorted.needsLatex).toBe(true);
    expect(sorted.answerMd).toContain("/media/import/img.png");
    // «Как выглядит GIL в деталях» has no «?» and no bold children → question at
    // subcategory level, attached to the root Python + reported as an anomaly.
    const anomaly = p.questions.find((q) => q.textMd.startsWith("Как выглядит GIL"))!;
    expect(anomaly.subCategoryTitle).toBeNull();
    expect(anomaly.rootCategoryTitle).toBe("Python");
    expect(p.anomalies.questionsAtSubcategoryLevel.map((a) => a.text)).toContain(
      "Как выглядит GIL в деталях",
    );
  });

  it("records the referenced image for copying", () => {
    const p = plan();
    expect(p.images).toEqual([{ originalDecodedPath: "img.png", normalizedName: "img.png" }]);
  });
});
