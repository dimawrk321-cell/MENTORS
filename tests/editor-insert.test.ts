import { describe, it, expect } from "vitest";
import { applySnippet } from "@/lib/utils/editor-insert";
import { renderMarkdownHtml } from "@/lib/utils/markdown";
import { SNIPPETS } from "@/lib/content/editor-snippets";

// D5 (spec 13.1): directive/formula insert wraps the selection instead of
// discarding it; the wrapped body is re-selected.
//
// Заход «Редактор блоков»: к этому добавлены изоляция пустыми строками по
// фактическому окружению и запрет вкладывать блок в блок — воспроизведённый
// баг владельца (вставил «Код», следом «Важное» → врезка внутри code-фенса).

const CALLOUT = { snippet: '\n:::callout{type="tip"}\n%s\n:::\n', placeholder: "Текст совета." };
const CODE = { snippet: "\n```python\n%s\n```\n", placeholder: 'print("hello")' };
const FORMULA = { snippet: "$%s$", placeholder: "" };
const TABLE = { snippet: "\n| A | B |\n", placeholder: "" };

describe("applySnippet — инлайновая вставка (D5, без изменений)", () => {
  it("Формула вставляет $…$ с курсором между долларами", () => {
    const res = applySnippet("ab", 1, 1, FORMULA);
    expect(res.content).toBe("a$$b");
    expect(res.selectionStart).toBe(2);
    expect(res.selectionEnd).toBe(2);
  });

  it("Формула оборачивает выделение как $выделение$", () => {
    const res = applySnippet("a x b", 2, 3, FORMULA);
    expect(res.content).toBe("a $x$ b");
    expect(res.content.slice(res.selectionStart, res.selectionEnd)).toBe("x");
  });
});

describe("applySnippet — блочная вставка оборачивает прозу", () => {
  it("оборачивает выделение и переселектит тело", () => {
    const res = applySnippet("до СЮДА после", 3, 7, CALLOUT);
    expect(res.content).toBe('до\n\n:::callout{type="tip"}\nСЮДА\n:::\n\nпосле');
    expect(res.content.slice(res.selectionStart, res.selectionEnd)).toBe("СЮДА");
  });

  it("без выделения берёт плейсхолдер и выделяет его", () => {
    const res = applySnippet("", 0, 0, CALLOUT);
    expect(res.content).toBe(':::callout{type="tip"}\nТекст совета.\n:::\n');
    expect(res.content.slice(res.selectionStart, res.selectionEnd)).toBe("Текст совета.");
  });

  it("сниппет без %s не съедает выделение", () => {
    const res = applySnippet("keep me", 0, 4, TABLE);
    expect(res.content.startsWith("keep me")).toBe(true);
    expect(res.content).toContain("| A | B |");
  });
});

describe("applySnippet — изоляция пустыми строками считается, а не хардкодится", () => {
  it("ровно одна пустая строка с каждой стороны", () => {
    expect(applySnippet("Абзац.", 6, 6, CALLOUT).content).toBe(
      'Абзац.\n\n:::callout{type="tip"}\nТекст совета.\n:::\n',
    );
    expect(applySnippet("Абзац.\nЕщё абзац.", 6, 6, CALLOUT).content).toBe(
      'Абзац.\n\n:::callout{type="tip"}\nТекст совета.\n:::\n\nЕщё абзац.',
    );
  });

  it("в пустом документе лишних пустых строк не появляется", () => {
    expect(applySnippet("", 0, 0, CALLOUT).content).toBe(
      ':::callout{type="tip"}\nТекст совета.\n:::\n',
    );
  });

  it("не плодит \\n\\n\\n на уже пустых строках", () => {
    const res = applySnippet("Абзац.\n\n\n\nЕщё.", 6, 6, CALLOUT);
    expect(res.content).not.toMatch(/\n{3}/);
    expect(res.content).toBe('Абзац.\n\n:::callout{type="tip"}\nТекст совета.\n:::\n\nЕщё.');
  });

  it("вставка в середину строки не разрывает её пополам", () => {
    // Курсор в середине абзаца → блок уезжает за конец строки.
    const res = applySnippet("Первый абзац.", 6, 6, CODE);
    expect(res.content).toBe('Первый абзац.\n\n```python\nprint("hello")\n```\n');
  });
});

describe("applySnippet — блок в блок не вкладывается (баг владельца)", () => {
  const doc = 'Абзац.\n\n```python\nprint("hello")\n```\n';

  it("врезка по выделению ВНУТРИ фенса уходит за фенс, а не оборачивает", () => {
    const start = doc.indexOf('print("hello")');
    const end = start + 'print("hello")'.length;
    const res = applySnippet(doc, start, end, CALLOUT);
    // Код цел, врезка стоит после закрывающего фенса.
    expect(res.content).toBe(
      'Абзац.\n\n```python\nprint("hello")\n```\n\n:::callout{type="tip"}\nТекст совета.\n:::\n',
    );
    expect(res.content.indexOf(":::callout")).toBeGreaterThan(res.content.lastIndexOf("```"));
  });

  it("курсор на строке открывающего фенса — тоже за фенс", () => {
    const at = doc.indexOf("```python") + 3;
    expect(applySnippet(doc, at, at, CALLOUT).content).toBe(
      'Абзац.\n\n```python\nprint("hello")\n```\n\n:::callout{type="tip"}\nТекст совета.\n:::\n',
    );
  });

  it("вставка внутрь :::-контейнера уходит за него", () => {
    const container = 'Абзац.\n\n:::callout{type="tip"}\nСовет.\n:::\n';
    const at = container.indexOf("Совет.") + 3;
    const res = applySnippet(container, at, at, CODE);
    expect(res.content).toBe(
      'Абзац.\n\n:::callout{type="tip"}\nСовет.\n:::\n\n```python\nprint("hello")\n```\n',
    );
    expect((res.content.match(/:::/g) ?? []).length).toBe(2); // контейнер не продублирован
  });

  it("вставка внутрь таблицы уходит за таблицу", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const at = table.indexOf("| 1 | 2 |") + 3;
    const res = applySnippet(table, at, at, CALLOUT);
    expect(res.content).toBe(
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n:::callout{type="tip"}\nТекст совета.\n:::\n',
    );
  });

  it("сценарий владельца: «Код», следом «Важное» — два соседних блока", () => {
    const IMPORTANT = {
      snippet: '\n:::callout{type="important"}\n%s\n:::\n',
      placeholder: "Важный текст.",
    };
    const doc0 = "Уже уверен в теме?";
    const step1 = applySnippet(doc0, doc0.length, doc0.length, CODE);
    // Плейсхолдер кода остаётся выделенным — ровно как в проде.
    expect(step1.content.slice(step1.selectionStart, step1.selectionEnd)).toBe('print("hello")');
    const step2 = applySnippet(step1.content, step1.selectionStart, step1.selectionEnd, IMPORTANT);
    expect(step2.content).toBe(
      'Уже уверен в теме?\n\n```python\nprint("hello")\n```\n\n:::callout{type="important"}\nВажный текст.\n:::\n',
    );
    // Ни одна директива не оказалась внутри фенса.
    expect(step2.content.indexOf(":::callout")).toBeGreaterThan(step2.content.lastIndexOf("```"));
  });
});

describe("вставка проходит через настоящий рендер без литеральных маркеров", () => {
  // Владелец видел `:::callout{...}` и ```` ``` ```` СЫРЬЁМ в уроке. Проверяем не
  // строку markdown, а то, что из неё получается: ни один маркер не должен
  // дожить до HTML.
  const blockSnippets = SNIPPETS.filter((s) => /^\n/.test(s.snippet) || /\n$/.test(s.snippet));

  it.each(blockSnippets.map((s) => [s.label, s] as const))(
    "«%s» в конец абзаца — маркеров в HTML нет",
    async (_label, def) => {
      const doc = "Обычный абзац урока.";
      const { content } = applySnippet(doc, doc.length, doc.length, def);
      const html = await renderMarkdownHtml(content);
      expect(html).not.toContain(":::");
      expect(html).not.toContain("```");
    },
  );

  it("две вставки подряд по живому выделению — маркеров в HTML нет", async () => {
    const code = SNIPPETS.find((s) => s.label === "Код")!;
    const important = SNIPPETS.find((s) => s.label === "Важное")!;
    const doc = "Уже уверен в теме?";
    const first = applySnippet(doc, doc.length, doc.length, code);
    const second = applySnippet(first.content, first.selectionStart, first.selectionEnd, important);
    const html = await renderMarkdownHtml(second.content);
    expect(html).not.toContain(":::");
    expect(html).not.toContain("```");
    expect(html).toContain("<callout-block");
    expect(html).toContain("language-python");
  });
});
