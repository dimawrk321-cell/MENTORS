import { describe, expect, it } from "vitest";
import { parse, renderBlock, serialize, withEdit, type Block } from "@/lib/content/markdown-blocks";
import { SNIPPETS } from "@/lib/content/editor-snippets";

// Walk 13.6 block 1. The invariant that matters: an untouched document must be
// written back BYTE-IDENTICAL, because content-admin notifies every student who
// completed a published lesson whenever contentMd differs. Everything else in
// the block editor is cosmetic; this file guards the part that can cause harm.

/** Real lesson body shapes: importer output, seeded content, hostile edges. */
const REAL_DOCS: Array<{ name: string; md: string }> = [
  {
    name: "seeded welcome lesson",
    md: `Добро пожаловать! Здесь всё устроено вокруг одной цели.

## Четыре опоры

- **Обучение** — курсы из уроков.
- **Тренажёр** — заучивание вопросов.

## Урок изнутри

Каждый урок — спокойная читальная колонка.

:::callout{type="tip"}
Не гонись за скоростью. Платформа сама возвращает тебя к слабым местам.
:::
`,
  },
  {
    name: "importer shapes (no blank lines around directives)",
    md: `:::mock{type="legend"}
:::

Текст урока.
:::callout{type="material"}
**Материал:** [Ссылка](https://example.com)
:::
:::practice
**Практика**

- [Задание](https://karpov.courses)
:::
`,
  },
  {
    name: "math, code, table, video",
    md: `Формула потерь:

$$
L(y, \\hat{p}) = -(y \\log \\hat{p})
$$

Инлайн: $\\sigma(w^\\top x)$.

\`\`\`python
import numpy as np

def f(x):
    return x
\`\`\`

| Метрика | Значение |
| --- | --- |
| F1 | 0.82 |

:::video{url="https://youtu.be/dQw4w9WgXcQ" title="Разбор"}
:::
`,
  },
  {
    name: "fence containing directive-like lines",
    md: `\`\`\`text
:::callout{type="tip"}
не директива, а пример
:::
\`\`\`
`,
  },
  {
    name: "unterminated directive",
    md: `:::callout{type="tip"}
забыли закрыть
`,
  },
  {
    name: "unquoted attrs (importer legacy)",
    md: `:::callout{type=tip}
Тело.
:::
`,
  },
  { name: "CRLF document", md: "Строка.\r\n\r\n## Заголовок\r\n\r\nХвост.\r\n" },
  { name: "empty", md: "" },
  { name: "only newlines", md: "\n\n\n" },
  { name: "no trailing newline", md: "Последняя строка без перевода" },
  { name: "money not math", md: "Цена $5 и $10 за штуку.\n" },
  { name: "tilde fence", md: "~~~js\nconst a = 1;\n~~~\n" },
];

describe("parse/serialize byte fidelity", () => {
  for (const doc of REAL_DOCS) {
    it(`concatenated raws reproduce the source exactly: ${doc.name}`, () => {
      const blocks = parse(doc.md);
      expect(blocks.map((b) => b.raw).join("")).toBe(doc.md);
    });

    it(`serialize() of an untouched parse is byte-identical: ${doc.name}`, () => {
      expect(serialize(parse(doc.md))).toBe(doc.md);
    });

    // The REAL guarantee, per block — this is what canUseBlockEditor was
    // supposed to be and never was (it compared an identity `parse` already
    // guarantees for any input, so it was always true and gated nothing).
    // Every block that gets a VISUAL editor must reproduce its own source from
    // its fields; anything else is demoted to a raw `prose` textarea.
    it(`every visual block re-renders to its own source: ${doc.name}`, () => {
      for (const block of parse(doc.md)) {
        if (block.kind === "prose") continue;
        expect(renderBlock(block), `${block.kind} block in ${doc.name}`).toBe(block.raw);
      }
    });
  }

  it("every insert template round-trips, so a freshly inserted block is safe", () => {
    for (const snippet of SNIPPETS) {
      const md = snippet.snippet.replace("%s", snippet.placeholder);
      expect(serialize(parse(md)), `snippet ${snippet.label}`).toBe(md);
    }
  });
});

describe("editability rail", () => {
  it("offers a visual editor for a well-formed callout", () => {
    const [block] = parse(':::callout{type="warning"}\nТело.\n:::\n');
    expect(block!.kind).toBe("callout");
    expect(block!.editable).toBe(true);
    expect(block!.variant).toBe("warning");
    expect(block!.body).toBe("Тело.");
  });

  it("downgrades an unquoted-attr callout to raw text instead of rewriting it", () => {
    // Re-rendering would emit type="tip" and change bytes → must NOT be editable
    // as a visual block; it becomes plain text so nothing shifts silently.
    const [block] = parse(":::callout{type=tip}\nТело.\n:::\n");
    expect(block!.kind).toBe("prose");
    expect(block!.editable).toBe(false);
    expect(block!.body).toBe(":::callout{type=tip}\nТело.\n:::\n");
  });

  it("downgrades an unterminated directive rather than repairing it", () => {
    const [block] = parse(':::callout{type="tip"}\nбез закрытия\n');
    expect(block!.kind).toBe("prose");
  });

  it("treats a fence containing ::: as opaque code, not a directive", () => {
    const blocks = parse('```text\n:::callout{type="tip"}\n:::\n```\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("code");
    expect(blocks[0]!.lang).toBe("text");
  });

  it("keeps a directive that ends the document (no trailing newline) editable", () => {
    // renderBlock must reuse the block's own terminator; hardcoding "\n" here
    // demoted the last block of a document to raw text.
    const md = ':::callout{type="material"}\n\n- [Глава](https://e.com)\n:::';
    const [block] = parse(md);
    expect(block!.kind).toBe("callout");
    expect(block!.editable).toBe(true);
    expect(serialize(parse(md))).toBe(md);
    expect(withEdit(block!, { body: "\n- [Другая](https://e.com)" }).raw.endsWith(":::")).toBe(
      true,
    );
  });

  it("keeps a title-less video editable (importer emitted url only)", () => {
    const md = ':::video{url="https://www.youtube.com/watch?v=-tK7WcE5Wfo"}\n:::\n';
    const [block] = parse(md);
    expect(block!.kind).toBe("video");
    expect(block!.editable).toBe(true);
    expect(block!.title).toBe("");
    expect(serialize(parse(md))).toBe(md);
    // Adding a title starts writing one; removing it drops the attribute again.
    expect(withEdit(block!, { title: "Разбор" }).raw).toContain('title="Разбор"');
  });

  it("does not mistake a single pipe line for a table", () => {
    const blocks = parse("| не таблица\n");
    expect(blocks[0]!.kind).toBe("prose");
  });

  it("keeps mock attributes inside the braces (mocks.ts greps for them)", () => {
    const [block] = parse(':::mock{type="theory"}\n:::\n');
    const edited = withEdit(block!, { variant: "legend" });
    expect(edited.raw).toBe(':::mock{type="legend"}\n:::\n');
    expect(/:::mock\{[^}]*type\s*=\s*"?(theory|legend)"?/.test(edited.raw)).toBe(true);
  });
});

describe("editing", () => {
  it("survives reorder, copy and delete before a save/load round-trip", () => {
    const source = 'Первый.\n\n:::callout{type="tip"}\nСовет.\n:::\n\nПоследний.\n';
    const blocks = parse(source);
    const first = blocks[0]!;
    const callout = blocks.find((block) => block.kind === "callout")!;
    const last = blocks.at(-1)!;

    // The same immutable array operations used by BlockEditor controls.
    const reordered = [callout, first, last];
    const copied = { ...callout, id: "copy", dirty: true };
    const withCopy = [...reordered.slice(0, 1), copied, ...reordered.slice(1)];
    const afterDelete = withCopy.filter((block) => block.id !== callout.id);
    const saved = serialize(afterDelete);
    const loaded = parse(saved);

    expect(loaded.map((block) => block.kind)).toEqual(["callout", "prose"]);
    expect(saved).toContain("Совет.");
    expect(saved).not.toContain("Совет.\n:::\n\n:::callout");
    expect(saved.indexOf("Первый.")).toBeLessThan(saved.indexOf("Последний."));
  });

  it("re-serialises only the edited block and leaves neighbours byte-identical", () => {
    const md = 'Первый.\n\n:::callout{type="tip"}\nСтарое.\n:::\n\nПоследний.\n';
    const blocks = parse(md);
    const idx = blocks.findIndex((b) => b.kind === "callout");
    const next = [...blocks];
    next[idx] = withEdit(blocks[idx]!, { body: "Новое." });

    const out = serialize(next);
    expect(out).toContain("Новое.");
    expect(out).not.toContain("Старое.");
    // Neighbours untouched, character for character.
    expect(out.startsWith("Первый.\n\n")).toBe(true);
    expect(out.endsWith("\nПоследний.\n")).toBe(true);
  });

  it("a no-op edit still produces the original bytes", () => {
    const md = ':::callout{type="tip"}\nТело.\n:::\n';
    const blocks = parse(md);
    const next = [withEdit(blocks[0]!, { body: "Тело." })];
    expect(serialize(next)).toBe(md);
  });

  it("renders each kind back to canonical markdown", () => {
    const cases: Array<[Partial<Block> & { kind: Block["kind"] }, string]> = [
      [
        { kind: "callout", variant: "important", body: "X" },
        ':::callout{type="important"}\nX\n:::\n',
      ],
      [{ kind: "video", url: "u", title: "t" }, ':::video{url="u" title="t"}\n:::\n'],
      [{ kind: "practice", body: "- п" }, ":::practice\n- п\n:::\n"],
      [{ kind: "mock", variant: "theory" }, ':::mock{type="theory"}\n:::\n'],
      [{ kind: "code", lang: "sql", body: "select 1" }, "```sql\nselect 1\n```\n"],
      [{ kind: "math", body: "a=b" }, "$$\na=b\n$$\n"],
    ];
    for (const [fields, expected] of cases) {
      const block = { ...parse("x\n")[0]!, ...fields } as Block;
      expect(renderBlock(block), fields.kind).toBe(expected);
    }
  });
});

describe("audit fixes over the block core", () => {
  it("escapes a quote in a video title so the block survives a reload", () => {
    const md = ':::video{url="https://x/y"}\n:::\n';
    const [block] = parse(md);
    const edited = withEdit(block!, { title: 'Лекция "про GIL" {важно}' });
    const round = parse(serialize([edited]));

    expect(round).toHaveLength(1);
    expect(round[0]!.kind).toBe("video");
    // The escaped form must decode back to exactly what was typed.
    expect(round[0]!.title).toBe('Лекция "про GIL" {важно}');
  });

  it("does not glue a new block onto a document that ended without a newline", () => {
    const md = "Абзац без перевода строки.";
    const blocks = parse(md);
    expect(blocks[blocks.length - 1]!.eol).toBe("");

    const added = {
      ...blocks[0]!,
      id: "new",
      kind: "callout" as const,
      variant: "info",
      body: "Совет.",
      raw: "",
      eol: "\n",
      dirty: true,
    };
    const out = serialize([...blocks, added]);
    expect(out).toContain("Абзац без перевода строки.\n\n:::callout");
    expect(out).not.toContain("строки.:::");
  });

  it("an untouched document still serialises byte-for-byte", () => {
    const md = "# Заголовок\n\nАбзац.\n\n```py\nx = 1\n```\n\nХвост без перевода";
    expect(serialize(parse(md))).toBe(md);
  });
});

describe("byte fidelity is per-block, not per-document", () => {
  // The two mechanisms the removed canUseBlockEditor rail was meant to provide.
  const MIXED =
    "# Заголовок\n\n" +
    ':::callout{type="tip"}\nСовет.\n:::\n\n' +
    "Обычный абзац.\n\n" +
    "```python\nx = 1\n```\n";

  it("an edit changes ONLY the edited block's bytes", () => {
    const blocks = parse(MIXED);
    const callout = blocks.find((b) => b.kind === "callout")!;
    const edited = blocks.map((b) =>
      b.id === callout.id ? withEdit(b, { body: "Новый совет." }) : b,
    );
    const out = serialize(edited);

    expect(out).toContain("Новый совет.");
    // Every other block is byte-identical, including the fence and the heading.
    expect(out).toContain("# Заголовок\n");
    expect(out).toContain("```python\nx = 1\n```\n");
    expect(out).toContain("Обычный абзац.\n");
  });

  it("a construct that would be normalised is demoted, not rewritten", () => {
    // A callout written with single quotes: the fields parse fine, but
    // re-rendering would normalise them to double quotes and change the bytes.
    // So it must NOT become a visual callout card — it stays raw text.
    const md = ":::callout{type='tip'}\nСовет.\n:::\n";
    const [block] = parse(md);
    expect(block!.kind).toBe("prose");
    expect(block!.body).toBe(md);
    expect(serialize(parse(md))).toBe(md);
  });

  it("the dirty flag is what selects re-rendering", () => {
    const blocks = parse(MIXED);
    expect(blocks.every((b) => !b.dirty)).toBe(true);
    expect(serialize(blocks)).toBe(MIXED);

    const touched = withEdit(blocks[0]!, {});
    expect(touched.dirty).toBe(true);
    expect(touched.raw).toBe(renderBlock(touched));
  });
});
