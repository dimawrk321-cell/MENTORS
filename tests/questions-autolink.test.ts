import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "./helpers/db";
import { buildImportPlan } from "@/lib/services/notion-import/plan";
import { commitPlan } from "@/lib/services/notion-import/commit";
import { autolinkQuestions } from "@/lib/services/questions-autolink";

// Walk 13.6 block 3. The hints («Категории вопросов для заучивания в базе») are
// stripped from content_md at import time, so the autolinker replays the plan
// from the same export. These tests use the importer itself to seed, then assert
// the linker is idempotent and never demotes an existing key link.

const FIXTURE = [
  "- **Спринты (основное обучение)**",
  "  - **Python + PyTorch**",
  "    - **Базовый синтаксис**",
  "",
  "      Тело урока про синтаксис.",
  "",
  "      **Категории вопросов для заучивания в базе:** Списки",
  "",
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

async function seedFromFixture() {
  const plan = buildImportPlan(FIXTURE, new Set());
  await commitPlan(testDb as never, plan, { dryRun: false });
}

describe("autolinkQuestions (spec 7.14 п.4)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedFromFixture();
  });

  it("dry-run reports the links without writing them", async () => {
    // The importer already links category questions, so start from a clean slate
    // to exercise creation deterministically.
    await testDb.questionLesson.deleteMany({});

    const dry = await autolinkQuestions(testDb as never, { markdown: FIXTURE, commit: false });
    expect(dry.lessonsWithHints).toBe(1);
    expect(dry.lessonsMatched).toBe(1);
    expect(dry.created).toBe(2); // both «Списки» questions
    expect(await testDb.questionLesson.count()).toBe(0);
  });

  it("commit creates «просто привязан» links (is_key=false, in_quiz=false)", async () => {
    await testDb.questionLesson.deleteMany({});

    const run = await autolinkQuestions(testDb as never, { markdown: FIXTURE, commit: true });
    expect(run.created).toBe(2);

    const links = await testDb.questionLesson.findMany();
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.isKey === false && l.inQuiz === false)).toBe(true);
  });

  it("is idempotent: a second commit creates nothing", async () => {
    await testDb.questionLesson.deleteMany({});
    await autolinkQuestions(testDb as never, { markdown: FIXTURE, commit: true });
    const before = await testDb.questionLesson.count();

    const again = await autolinkQuestions(testDb as never, { markdown: FIXTURE, commit: true });
    expect(again.created).toBe(0);
    expect(again.skippedExisting).toBe(before);
    expect(await testDb.questionLesson.count()).toBe(before);
  });

  it("NEVER demotes an existing key link", async () => {
    await testDb.questionLesson.deleteMany({});
    const lesson = await testDb.lesson.findFirstOrThrow({ where: { slug: "bazovyy-sintaksis" } });
    const question = await testDb.question.findFirstOrThrow();
    await testDb.questionLesson.create({
      data: { lessonId: lesson.id, questionId: question.id, isKey: true, inQuiz: true },
    });

    await autolinkQuestions(testDb as never, { markdown: FIXTURE, commit: true });

    const kept = await testDb.questionLesson.findFirstOrThrow({
      where: { lessonId: lesson.id, questionId: question.id },
    });
    expect(kept.isKey).toBe(true);
    expect(kept.inQuiz).toBe(true);
  });

  it("ignores an unresolvable hint NAME (the import plan filters it upstream)", async () => {
    const withUnknown = FIXTURE.replace(
      "**Категории вопросов для заучивания в базе:** Списки",
      "**Категории вопросов для заучивания в базе:** Списки; Такой Категории Нет",
    );
    await testDb.questionLesson.deleteMany({});
    const report = await autolinkQuestions(testDb as never, {
      markdown: withUnknown,
      commit: false,
    });
    // resolveCategoryLinks() drops names it cannot match and reports them in the
    // importer's own anomalies, so the linker only ever sees resolved slugs.
    expect(report.lessonsMatched).toBe(1);
    expect(report.created).toBe(2);
    expect(report.categoriesMissing).toEqual([]);
  });

  it("reports a resolved slug whose category row is absent in THIS database", async () => {
    // The real missing-row case: linking against a DB that was seeded from a
    // different/partial import.
    await testDb.questionLesson.deleteMany({});
    await testDb.question.deleteMany({});
    await testDb.questionCategory.deleteMany({});

    const report = await autolinkQuestions(testDb as never, { markdown: FIXTURE, commit: false });
    expect(report.lessonsMatched).toBe(1);
    expect(report.categoriesMissing.length).toBeGreaterThan(0);
    expect(report.created).toBe(0);
  });
});
