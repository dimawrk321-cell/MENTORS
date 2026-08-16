import { describe, expect, it } from "vitest";
import { parse, renderBlock, serialize, withEdit } from "@/lib/content/markdown-blocks";
import { SNIPPETS } from "@/lib/content/editor-snippets";
import { renderLessonHast } from "@/lib/utils/markdown";

// Заход B.1, блок 1. Требование задания: обратная сборка воспроизводит raw
// СИМВОЛ В СИМВОЛ. Это не косметика: `saveLessonContent` шлёт уведомление
// «урок обновлён» каждому прошедшему ученику, когда contentMd отличается от
// сохранённого, — потеря байта на открытии урока ментором = рассылка.

const SPOILER = ':::spoiler{title="Почему так?"}\nПотому что.\n:::\n';

/** Все восемь существующих типов + два новых — регресс round-trip (регресс-лист). */
const EVERY_KIND = [
  "Абзац прозы.\n",
  "```python\nx = 1\n```\n",
  ':::callout{type="tip"}\nСовет.\n:::\n',
  ':::video{url="https://youtu.be/dQw4w9WgXcQ" title="Разбор"}\n:::\n',
  ":::practice\n- [Задание](https://karpov.courses)\n:::\n",
  ':::mock{type="legend"}\n:::\n',
  "$$\nE = mc^2\n$$\n",
  "| Колонка | Колонка |\n| --- | --- |\n| Ячейка | Ячейка |\n",
  SPOILER,
  ':::question{id="q1"}\n:::\n',
].join("\n");

describe("«Скрытый ответ»: round-trip", () => {
  it("парсится как spoiler с заголовком и телом", () => {
    const [block] = parse(SPOILER);
    expect(block!.kind).toBe("spoiler");
    expect(block!.editable).toBe(true);
    expect(block!.title).toBe("Почему так?");
    expect(block!.body).toBe("Потому что.");
  });

  it("renderBlock воспроизводит исходник символ в символ", () => {
    for (const md of [
      SPOILER,
      ":::spoiler\nБез заголовка.\n:::\n",
      ':::spoiler{title="Хвост без перевода строки"}\nТело.\n:::',
      ':::spoiler{title="Многострочный"}\nПервый абзац.\n\nВторой абзац.\n:::\n',
    ]) {
      const [block] = parse(md);
      expect(block!.kind, md).toBe("spoiler");
      expect(renderBlock(block!), md).toBe(block!.raw);
      expect(serialize(parse(md)), md).toBe(md);
    }
  });

  it("экранирует кавычки и скобки в заголовке — блок переживает перезагрузку", () => {
    const [block] = parse(SPOILER);
    const edited = withEdit(block!, { title: 'Что такое "GIL" {важно}?' });
    const round = parse(serialize([edited]));
    expect(round[0]!.kind).toBe("spoiler");
    expect(round[0]!.title).toBe('Что такое "GIL" {важно}?');
  });

  it("документ со всеми десятью типами возвращается байт-в-байт", () => {
    expect(serialize(parse(EVERY_KIND))).toBe(EVERY_KIND);
    for (const block of parse(EVERY_KIND)) {
      if (block.kind === "prose") continue;
      expect(renderBlock(block), block.kind).toBe(block.raw);
    }
  });

  it("правка спойлера не трогает байты соседей", () => {
    const md = `Первый.\n\n${SPOILER}\nПоследний.\n`;
    const blocks = parse(md);
    const idx = blocks.findIndex((b) => b.kind === "spoiler");
    const next = [...blocks];
    next[idx] = withEdit(blocks[idx]!, { body: "Новое." });
    const out = serialize(next);
    expect(out).toContain("Новое.");
    expect(out.startsWith("Первый.\n\n")).toBe(true);
    expect(out.endsWith("\nПоследний.\n")).toBe(true);
  });

  it("шаблон кнопки вставки round-trip'ится (иначе новый блок сразу деградирует)", () => {
    const spoiler = SNIPPETS.find((s) => s.label === "Скрытый ответ")!;
    const md = spoiler.snippet.replace("%s", spoiler.placeholder);
    expect(serialize(parse(md))).toBe(md);
    const inner = parse(md).find((b) => b.kind === "spoiler");
    expect(inner).toBeTruthy();
  });

  it("незакрытый спойлер деградирует в сырой текст, а не «чинится»", () => {
    const [block] = parse(':::spoiler{title="X"}\nбез закрытия\n');
    expect(block!.kind).toBe("prose");
  });
});

describe("«Скрытый ответ»: рендер и оглавление", () => {
  it("директива компилируется в spoiler-block с заголовком", async () => {
    const { hast } = await renderLessonHast(SPOILER);
    const html = JSON.stringify(hast);
    expect(html).toContain("spoiler-block");
    expect(html).toContain("Почему так?");
    expect(html).toContain("Потому что.");
  });

  it("заголовок внутри спойлера не попадает в оглавление, но якорь сохраняет", async () => {
    const md =
      '## Видимый раздел\n\n:::spoiler{title="Ответ"}\n### Спрятанный заголовок\n\nТекст.\n:::\n';
    const { hast, headings } = await renderLessonHast(md);
    expect(headings.map((h) => h.text)).toEqual(["Видимый раздел"]);
    // rehypeSlug по-прежнему проставил id — прямая ссылка на якорь работает.
    expect(JSON.stringify(hast)).toContain("спрятанный-заголовок");
  });
});
