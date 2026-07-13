import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "./helpers/db";
import { buildImportPlan } from "@/lib/services/notion-import/plan";
import { commitPlan, type CommitResult } from "@/lib/services/notion-import/commit";
import { renderLessonHast } from "@/lib/utils/markdown";

// DB-backed importer tests (spec 7.14): idempotent skip-if-exists, and a render
// pass over the whole real export so no imported markdown crashes the pipeline.

const IMPORT_FIXTURE = [
  "- **Спринты (основное обучение)**",
  "  - **Python + PyTorch**",
  "    - **Базовый синтаксис**",
  "",
  "      Тело урока про синтаксис.",
  "",
  "      **Категории вопросов для заучивания в базе:** Списки",
  "",
  "      **Проверка себя:** объясни изменяемость списка.",
  "- **Вопросы с собеседований**",
  "  - **Техническое собеседование**",
  "    - **Python**",
  "      - **Списки**",
  "        - **Что такое список?**",
  "",
  "          Список — изменяемая коллекция.",
  "        - **Как развернуть список?**",
  "",
  "          `list[::-1]` или `reversed()`.",
].join("\n");

function totalCreated(result: CommitResult): number {
  return (
    result.courses.created +
    result.modules.created +
    result.lessons.created +
    result.categories.created +
    result.questions.created +
    result.keyQuestions.created +
    result.keyLinks.created +
    result.categoryLinks.created
  );
}

describe("commitPlan — idempotent skip-if-exists (spec 7.14)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates everything as draft on the first commit, nothing on the second", async () => {
    const plan = buildImportPlan(IMPORT_FIXTURE, new Set());

    const first = await commitPlan(testDb, plan, { dryRun: false });
    expect(first.courses.created).toBe(1);
    expect(first.lessons.created).toBe(1);
    expect(first.questions.created).toBe(2); // Что такое / Как развернуть
    expect(first.keyQuestions.created).toBe(1); // Проверка себя
    expect(first.categoryLinks.created).toBeGreaterThanOrEqual(2); // «Списки» → both

    // Nothing published automatically.
    const publishedCourses = await testDb.course.count({ where: { status: "published" } });
    const publishedQuestions = await testDb.question.count({ where: { status: "published" } });
    expect(publishedCourses).toBe(0);
    expect(publishedQuestions).toBe(0);

    // Every imported question is source=import, draft.
    const questions = await testDb.question.findMany();
    expect(questions.every((q) => q.source === "import" && q.status === "draft")).toBe(true);

    const second = await commitPlan(testDb, plan, { dryRun: false });
    expect(totalCreated(second)).toBe(0); // fully idempotent

    // Row counts did not grow after the second run.
    expect(await testDb.course.count()).toBe(1);
    expect(await testDb.lesson.count()).toBe(1);
    expect(await testDb.question.count()).toBe(3); // 2 bank + 1 key
    expect(await testDb.questionLesson.count()).toBe(3); // 1 is_key + 2 category links
  });

  it("dry-run counts match the real commit on a fresh DB (review fix A/C)", async () => {
    const plan = buildImportPlan(IMPORT_FIXTURE, new Set());
    const dry = await commitPlan(testDb, plan, { dryRun: true });
    expect(await testDb.course.count()).toBe(0); // dry-run wrote nothing

    const wet = await commitPlan(testDb, plan, { dryRun: false });
    expect(dry.courses).toEqual(wet.courses);
    expect(dry.modules).toEqual(wet.modules);
    expect(dry.lessons).toEqual(wet.lessons);
    expect(dry.categories).toEqual(wet.categories);
    expect(dry.questions).toEqual(wet.questions);
    expect(dry.keyQuestions).toEqual(wet.keyQuestions);
    expect(dry.keyLinks).toEqual(wet.keyLinks);
    expect(dry.categoryLinks).toEqual(wet.categoryLinks); // was undercounted to 0 before the fix
    expect(wet.categoryLinks.created).toBeGreaterThanOrEqual(2);
  });

  it("does not collapse two lessons whose cleaned titles match (review fix B)", async () => {
    const fixture = [
      "- **Спринты (основное обучение)**",
      "  - **Python + PyTorch**",
      "    - **Трансформеры**",
      "",
      "      Первый урок.",
      "    - **Трансформеры (ДОПОЛНИТЕЛЬНО: разбор статьи)**",
      "",
      "      Второй урок.",
    ].join("\n");
    const plan = buildImportPlan(fixture, new Set());
    const lessons = plan.courses[0]!.modules[0]!.lessons;
    expect(lessons.map((l) => l.title)).toEqual(["Трансформеры", "Трансформеры"]);
    expect(new Set(lessons.map((l) => l.slug)).size).toBe(2); // distinct slugs

    const res = await commitPlan(testDb, plan, { dryRun: false });
    expect(res.lessons.created).toBe(2);
    expect(await testDb.lesson.count()).toBe(2); // both persisted — second not collapsed onto the first
  });

  it("mutual exclusivity: category-link and key-question links are is_key-correct", async () => {
    const plan = buildImportPlan(IMPORT_FIXTURE, new Set());
    await commitPlan(testDb, plan, { dryRun: false });
    const links = await testDb.questionLesson.findMany({ include: { question: true } });
    for (const link of links) {
      expect(link.inQuiz).toBe(false); // importer never sets in_quiz
      // The «Проверка себя» question is is_key; the two «Списки» bank questions are just-linked.
      if (link.question.textMd.startsWith("объясни")) expect(link.isKey).toBe(true);
      else expect(link.isKey).toBe(false);
    }
  });
});

/** Finds the real Notion export .md under import/notion, if present. */
function findRealExport(): { file: string; images: Set<string> } | null {
  const root = path.resolve(process.cwd(), "import/notion");
  if (!fs.existsSync(root)) return null;
  let mdFile: string | null = null;
  const images = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md") && !mdFile) mdFile = full;
      else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)) images.add(entry.name);
    }
  };
  walk(root);
  return mdFile ? { file: mdFile, images } : null;
}

describe("render pipeline over the real export (spec 7.14: no crashes)", () => {
  const real = findRealExport();

  it.skipIf(!real)(
    "renders every imported lesson, answer and key question without throwing",
    async () => {
      const markdown = fs.readFileSync(real!.file, "utf8");
      const plan = buildImportPlan(markdown, real!.images);

      const docs: string[] = [];
      for (const course of plan.courses)
        for (const mod of course.modules)
          for (const lesson of mod.lessons) {
            docs.push(lesson.contentMd);
            for (const key of lesson.keyQuestions) docs.push(key.textMd);
          }
      for (const question of plan.questions) {
        docs.push(question.textMd);
        if (question.answerMd) docs.push(question.answerMd);
      }

      let rendered = 0;
      for (const doc of docs) {
        await renderLessonHast(doc); // throws on a malformed pipeline input
        rendered += 1;
      }
      expect(rendered).toBe(docs.length);
      expect(rendered).toBeGreaterThan(400);
    },
    180_000,
  );
});
