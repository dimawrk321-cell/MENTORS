import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { richTextExtensions } from "@/lib/content/rich-text";
import { renderMarkdownHtml } from "@/lib/utils/markdown";

const editors: Editor[] = [];

function markdownEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: richTextExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("hybrid rich-text markdown", () => {
  it("loads and saves a long structured prose block without splitting it", () => {
    const source = `# Большой материал

Вводный **жирный** и *курсивный* текст с [ссылкой](https://example.com) и \`inline_code\`.

## Раздел

- первый пункт
- второй пункт

1. шаг один
2. шаг два

> Важная цитата.

![Схема](https://example.com/schema.png)
`;
    const saved = markdownEditor(source).getMarkdown();

    expect(saved).toContain("# Большой материал");
    expect(saved).toContain("## Раздел");
    expect(saved).toContain("**жирный**");
    expect(saved).toContain("[ссылкой](https://example.com)");
    expect(saved).toContain("`inline_code`");
    expect(saved).toContain("- первый пункт");
    expect(saved).toContain("1. шаг один");
    expect(saved).toContain("> Важная цитата.");
    expect(saved).toContain("![Схема](https://example.com/schema.png)");
  });

  it("round-trips underline and author-selected text sizes", () => {
    const source =
      "Обычный :underline[подчёркнутый [текст](https://example.com)] и :small[мелкий], а ещё :large[крупный].";
    const saved = markdownEditor(source).getMarkdown();

    expect(saved).toContain(":underline[подчёркнутый [текст](https://example.com)]");
    expect(saved).toContain(":small[мелкий]");
    expect(saved).toContain(":large[крупный]");
  });

  it("student renderer understands the rich-only inline directives", async () => {
    const html = await renderMarkdownHtml(":underline[Подчёркнуто] :small[Мелко] :large[Крупно]");

    expect(html).toContain("<u>Подчёркнуто</u>");
    expect(html).toContain('class="rt-small"');
    expect(html).toContain('class="rt-large"');
  });
});
