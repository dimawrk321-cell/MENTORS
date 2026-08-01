import { describe, expect, it } from "vitest";
import { SNIPPETS, snippetsFor, stripPlaceholderBlocks } from "@/lib/content/editor-snippets";
import { applySnippet } from "@/lib/utils/editor-insert";

// Walk 13.6 block 1.5: the cleaner removes untouched insert templates and NOTHING
// else. These tests pin that boundary, since a false positive would silently
// delete real lesson content.

describe("snippetsFor", () => {
  it("gives the lesson editor the full table and the guide editor a subset", () => {
    expect(snippetsFor("lesson")).toHaveLength(SNIPPETS.length);
    const guide = snippetsFor("guide").map((s) => s.label);
    expect(guide).not.toContain("Мок-интервью");
    expect(guide).not.toContain("Предупреждение");
    expect(guide).toContain("Совет");
  });
});

describe("stripPlaceholderBlocks", () => {
  it("removes an untouched callout inserted by the toolbar", () => {
    // Build the junk exactly the way the button does.
    const tip = SNIPPETS.find((s) => s.label === "Совет")!;
    const inserted = applySnippet("Настоящий текст.", 16, 16, tip).content;
    expect(inserted).toContain("Текст совета.");

    const { content, removed } = stripPlaceholderBlocks(inserted);
    expect(content).toBe("Настоящий текст.\n");
    expect(removed.reduce((n, r) => n + r.count, 0)).toBe(1);
  });

  it("KEEPS a callout whose text the mentor actually edited", () => {
    const md = ':::callout{type="tip"}\nНе гонись за скоростью.\n:::\n';
    expect(stripPlaceholderBlocks(md).content).toContain("Не гонись за скоростью.");
    expect(stripPlaceholderBlocks(md).removed).toHaveLength(0);
  });

  it("removes repeated identical templates and counts them", () => {
    const md =
      'Начало.\n\n:::callout{type="warning"}\nПредупреждение.\n:::\n\n:::callout{type="warning"}\nПредупреждение.\n:::\n\nКонец.';
    const { content, removed } = stripPlaceholderBlocks(md);
    expect(content).toBe("Начало.\n\nКонец.\n");
    expect(removed.find((r) => r.block === "Предупреждение")!.count).toBe(2);
  });

  it("removes the placeholder video / practice blocks", () => {
    const md =
      'A\n\n:::video{url="https://youtu.be/..." title="Название"}\n:::\n\n:::practice\n\n- [Задание](https://)\n:::\n\nB';
    const { content } = stripPlaceholderBlocks(md);
    expect(content).toBe("A\n\nB\n");
  });

  it("NEVER removes a :::mock block — it is real content, not a placeholder", () => {
    // The importer prepends this exact block to soft-skills lessons and
    // mocks.ts greps contentMd for it to auto-complete the lesson after a
    // booking; an empty mock directive has no placeholder body, so it cannot be
    // told apart from a deliberate one. A stand dry-run caught the cleaner
    // trying to delete three real mock lessons.
    const md = ':::mock{type="legend"}\n:::\n\n### Просмотр интервью\n';
    const { content, removed } = stripPlaceholderBlocks(md);
    expect(content).toContain(':::mock{type="legend"}');
    expect(removed).toHaveLength(0);
  });

  it("KEEPS a real video block with a real url", () => {
    const md = ':::video{url="https://youtu.be/dQw4w9WgXcQ" title="Разбор"}\n:::\n';
    expect(stripPlaceholderBlocks(md).content).toContain("dQw4w9WgXcQ");
  });

  it("removes the legacy $$ E = mc^2 $$ sample and orphan lone $ lines", () => {
    const md = "Текст.\n\n$$\nE = mc^2\n$$\n\n$\n\nХвост.";
    const { content, removed } = stripPlaceholderBlocks(md);
    expect(content).not.toContain("mc^2");
    expect(content).toContain("Текст.");
    expect(content).toContain("Хвост.");
    expect(removed.some((r) => r.block.includes("одинокая"))).toBe(true);
  });

  it("KEEPS real formulas", () => {
    const md = "Дисперсия: $\\sigma^2 = E[(X-\\mu)^2]$ — вот так.\n\n$$\na^2 + b^2 = c^2\n$$\n";
    const { content, removed } = stripPlaceholderBlocks(md);
    expect(content).toContain("\\sigma^2");
    expect(content).toContain("a^2 + b^2 = c^2");
    expect(removed).toHaveLength(0);
  });

  it("KEEPS a real code block and a real table", () => {
    const md =
      "```python\nimport torch\n```\n\n| Метрика | Значение |\n| --- | --- |\n| F1 | 0.82 |\n";
    const { content, removed } = stripPlaceholderBlocks(md);
    expect(content).toContain("import torch");
    expect(content).toContain("F1");
    expect(removed).toHaveLength(0);
  });

  it("removes the untouched python template but keeps surrounding prose", () => {
    const md = 'До.\n\n```python\nprint("hello")\n```\n\nПосле.';
    const { content } = stripPlaceholderBlocks(md);
    expect(content).toBe("До.\n\nПосле.\n");
  });

  it("is a no-op on clean content", () => {
    const md = "# Заголовок\n\nАбзац.\n\n## Второй\n\n- пункт\n";
    const { content, removed } = stripPlaceholderBlocks(md);
    expect(removed).toHaveLength(0);
    expect(content).toBe(md);
  });

  it("collapses the blank-line runs the removals leave behind", () => {
    const md = 'A\n\n:::callout{type="tip"}\nТекст совета.\n:::\n\nB';
    expect(stripPlaceholderBlocks(md).content).toBe("A\n\nB\n");
  });
});
