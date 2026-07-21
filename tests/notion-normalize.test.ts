import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { normalizeImportedMarkdown } from "@/lib/services/notion-import/normalize";
import { convertLessonBody } from "@/lib/services/notion-import/content";
import type { ImageResolver } from "@/lib/services/notion-import/images";
import { renderMarkdownHtml } from "@/lib/utils/markdown";

// Walk 12.3 P3a: the importer produced markdown where a section body was nested
// deeper than its heading, leaving a ≥4-space residual indent → CommonMark
// indented code block → literal «### …» and bare «[url](url)». The normalizer
// re-indents to canonical structure while preserving fenced code and tables.

const stub: ImageResolver = { resolve: () => null, refs: () => [] };

describe("normalizeImportedMarkdown", () => {
  it("de-indents an over-nested section so headings and links parse", async () => {
    // «### 1.» at the common-min indent, the rest of the section deeper (the real
    // «Инференс LLM» shape): after dedent the body keeps a 4-space residual.
    const md = [
      "### 1. Как работает",
      "",
      "    [https://habr.com/x](https://habr.com/x)",
      "",
      "    Закрывает:",
      "",
      "    - KV-cache,",
      "    - batching,",
      "",
      "    ### 2. Дальше",
    ].join("\n");

    const html = await renderMarkdownHtml(normalizeImportedMarkdown(md));
    expect(html).not.toMatch(/<pre><code/); // no accidental code block
    expect(html).not.toContain("### 2."); // heading is a heading, not literal text
    expect(html).toContain("<h3"); // both «###» became real headings
    expect(html).toMatch(/<a href="https:\/\/habr\.com\/x"/); // link is clickable
    expect(html).toContain("<ul>"); // the bullet list survived
  });

  it("preserves fenced code and GFM tables verbatim", async () => {
    const md = [
      "        Код:",
      "        ```python",
      "        def f(x):",
      "            return x + 1",
      "        ```",
      "        Таблица:",
      "        | a | b |",
      "        | - | - |",
      "        | 1 | 2 |",
    ].join("\n");

    const normalized = normalizeImportedMarkdown(md);
    // code body keeps its own indentation; the fence itself is de-indented to col 0
    expect(normalized).toContain("```python\ndef f(x):\n    return x + 1\n```");

    const html = await renderMarkdownHtml(normalized);
    expect(html).toContain("<table>");
    expect(html).toMatch(/<pre><code/); // the ONE real code block is preserved
    expect(html).toContain("return x + 1");
  });

  it("keeps a genuine nested list nested (2-space step)", () => {
    const md = ["- верхний", "    - вложенный", "        - глубже"].join("\n");
    expect(normalizeImportedMarkdown(md)).toBe("- верхний\n  - вложенный\n    - глубже");
  });

  it("is idempotent", () => {
    const md = [
      "### Заголовок",
      "    текст",
      "    - пункт",
      "        - вложенный",
      "    | a | b |",
      "    | - | - |",
    ].join("\n");
    const once = normalizeImportedMarkdown(md);
    expect(normalizeImportedMarkdown(once)).toBe(once);
  });
});

/** Locates the real Notion export md, if present in the working tree. */
function findRealExport(): string | null {
  const root = path.resolve(process.cwd(), "import/notion");
  if (!fs.existsSync(root)) return null;
  let found: string | null = null;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md") && !found) found = full;
    }
  };
  walk(root);
  return found;
}

describe("P3a regression on the real «Инференс LLM» lesson", () => {
  const file = findRealExport();

  it.skipIf(!file)("renders section headings and links, not literal text", async () => {
    // The node lives around a bold bullet «- **Инференс LLM**»; slice its subtree
    // out of the raw export and run it through the real converter + renderer.
    const md = fs.readFileSync(file!, "utf8");
    const lines = md.split(/\r?\n/);
    const startIdx = lines.findIndex((l) => /^\s*[-*]\s+\*\*Инференс LLM\*\*\s*$/.test(l));
    expect(startIdx).toBeGreaterThan(-1);
    const startIndent = lines[startIdx]!.length - lines[startIdx]!.trimStart().length;
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i += 1) {
      const l = lines[i]!;
      if (l.trim() === "") continue;
      const indent = l.length - l.trimStart().length;
      if (indent <= startIndent && /\S/.test(l)) {
        endIdx = i;
        break;
      }
    }
    const rawBody = lines.slice(startIdx + 1, endIdx).join("\n");
    const { contentMd } = convertLessonBody(rawBody, stub);
    const html = await renderMarkdownHtml(contentMd);

    expect(html).not.toContain("### "); // no literal ATX heading text
    expect(html).toMatch(/<a href="https:\/\/habr\.com/); // habr links are clickable
    // Every «###» in the source became a real heading, none a code block.
    expect(html).not.toMatch(/<pre><code[^>]*>[^<]*###/);
  });
});
