import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "./helpers/db";
import { buildImportPlan } from "@/lib/services/notion-import/plan";
import { commitPlan } from "@/lib/services/notion-import/commit";
import { renderReport } from "@/lib/services/notion-import/report";
import { renderLessonHast } from "@/lib/utils/markdown";

// Importer part 2 (spec 7.14 / 7.10): section mapping, idempotency, report.

const GUIDE_FIXTURE = [
  "- **Спринты (основное обучение)**",
  "  - **Основные инструменты, используемые на работе**",
  "",
  "    Вступление к инструментам.",
  "",
  "    - **Docker — контейнеризация**",
  "      - **Зачем:** контейнеры.",
  "",
  "        🎥 [Docker](https://youtu.be/aZTL2zRmOnA)",
  "    - **Kafka — брокер сообщений**",
  "      - **Зачем:** очереди сообщений.",
  "- **Гайды по резюме и легенде**",
  "  - **Резюме**",
  "    - **Шапка и контакты**",
  "",
  "      Контакты вверху страницы.",
  "    - **Опыт работы**",
  "",
  "      Ровно четыре буллета.",
  "  - **Легенда**",
  "    - **Оформление легенды**",
  "",
  "      Как собрать связную историю.",
  "- **Вопросы, которые нужно задать на собеседовании**",
  "  - **Вопросы для HR**",
  "    - **Про команду**",
  "",
  "      - Из кого состоит команда?",
  "  - **Вопросы для тимлида**",
  "",
  "    - Какие задачи в первые месяцы?",
  "- **Гайд по успешному прохождению всех этапов собеседований**",
  "  - **Скрининг**",
  "",
  "    Как проходить скрининг.",
  "  - **Лайфкодинг**",
  "",
  "    Как решать задачи вслух.",
  "- **Пространство для поиска работы**",
  "",
  "  Ищем на hh.ru и в телеграме.",
  "",
  "  https://t.me/jobs",
  "- **Собеседования**",
  "",
  "  https://disk.yandex.ru/d/abc123",
].join("\n");

function bySection(guides: { section: string }[], section: string): number {
  return guides.filter((g) => g.section === section).length;
}

describe("importer part 2 — guide section mapping (spec 7.14 part 2)", () => {
  it("routes the six guide sections and skips the Я.Диск section", () => {
    const plan = buildImportPlan(GUIDE_FIXTURE, new Set());

    expect(plan.guides.length).toBe(10);
    expect(bySection(plan.guides, "tools")).toBe(2);
    expect(bySection(plan.guides, "resume")).toBe(2);
    expect(bySection(plan.guides, "legend")).toBe(1);
    expect(bySection(plan.guides, "ask_interviewer")).toBe(2);
    expect(bySection(plan.guides, "stages")).toBe(2);
    expect(bySection(plan.guides, "job_search")).toBe(1);

    // «Собеседования» (Я.Диск) is skipped with a note, not imported.
    expect(
      plan.guides.some((g) => g.section === "job_search" && /Пространство/.test(g.title)),
    ).toBe(true);
    expect(plan.anomalies.skippedSections.some((s) => /Собеседования/.test(s.title))).toBe(true);

    // Emoji-prefixed YouTube link → inline :::video (guides have no header video).
    const docker = plan.guides.find((g) => /Docker/.test(g.title));
    expect(docker?.contentMd).toContain(":::video");
  });

  it("gives every guide a globally-unique slug", () => {
    const plan = buildImportPlan(GUIDE_FIXTURE, new Set());
    const slugs = plan.guides.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("importer part 2 — commit idempotency & render (spec 7.14)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates guides as draft on first commit, nothing on the second", async () => {
    const plan = buildImportPlan(GUIDE_FIXTURE, new Set());

    const first = await commitPlan(testDb, plan, { dryRun: false });
    expect(first.guides.created).toBe(10);
    expect(first.guides.skipped).toBe(0);

    expect(await testDb.guide.count()).toBe(10);
    expect(await testDb.guide.count({ where: { status: "published" } })).toBe(0);

    const second = await commitPlan(testDb, plan, { dryRun: false });
    expect(second.guides.created).toBe(0);
    expect(second.guides.skipped).toBe(10);
    expect(await testDb.guide.count()).toBe(10);
  });

  it("does not crash the markdown pipeline on any imported guide", async () => {
    const plan = buildImportPlan(GUIDE_FIXTURE, new Set());
    for (const guide of plan.guides) {
      await expect(renderLessonHast(guide.contentMd)).resolves.toBeDefined();
    }
  });
});

describe("importer part 2 — report (spec 7.14 п.6)", () => {
  it("adds a guides total and a per-section breakdown", async () => {
    const plan = buildImportPlan(GUIDE_FIXTURE, new Set());
    const result = await commitPlan(testDb, plan, { dryRun: true });
    const report = renderReport(plan, result, {
      file: "fixture.md",
      imagesCopied: 0,
      imagesMissing: 0,
    });

    expect(report).toContain("Гайды по секциям");
    expect(report).toContain("Инструменты индустрии: 2");
    expect(report).toContain("Поиск работы: 1");
    expect(report).toMatch(/Гайды \(справочник, часть 2\): создано 10/);
  });
});
