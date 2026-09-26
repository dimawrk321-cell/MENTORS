import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeReadingMinutes, renderMarkdownHtml } from "@/lib/utils/markdown";

const source = readFileSync(
  resolve(process.cwd(), "content-source/vibe-coding-python-codex.md"),
  "utf8",
);

describe("гайд по вайб-кодингу", () => {
  it("сохраняет все шесть исходных разделов и ключевые практические контракты", () => {
    const sections = source.match(/^## \d+\. .+$/gm) ?? [];
    expect(sections).toEqual([
      "## 1. План работы",
      "## 2. Результат, который должен быть к концу гайда",
      "## 3. Рабочая среда с полного нуля",
      "## 4. Работа с API и проектирование приложения",
      "## 5. Система промптов для Codex",
      "## 6. Финальная симуляция собеседования",
    ]);
    expect(source).toContain("POST /predict");
    expect(source).toContain("GET /health");
    expect(source).toContain("uv run pytest -q");
    expect(source).toContain("uv run ruff check .");
    expect(source).toContain("POST /analyze");
    expect(source.match(/^- \[ \] /gm)).toHaveLength(30);
  });

  it("проходит единый markdown-рендер платформы", async () => {
    const html = await renderMarkdownHtml(source);
    expect(html).toContain("<table>");
    expect(html).toContain("<callout-block");
    expect(html).toContain("<spoiler-block");
    expect(html).not.toContain(":::callout");
    expect(html).not.toContain(":::spoiler");
    expect((source.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(computeReadingMinutes(source)).toBeGreaterThanOrEqual(15);
  });

  it("не содержит следов незавершённого переноса", () => {
    expect(source).not.toMatch(/\bTODO\b/);
    expect(source).not.toContain("app.notion.com");
    expect(source).not.toContain("undefined");
  });
});
