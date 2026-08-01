// Single source of truth for the editor's insert blocks (walk 13.6). Previously
// this table was duplicated in lesson-editor.tsx and guide-editor.tsx, and the
// cleanup script had no way to know what a "still-untouched template" looks
// like. Both editors now pick a subset by label, and the placeholder stripper
// below is derived from the SAME table — so it can never drift from what the
// buttons insert.

export interface SnippetDef {
  group: "Врезки" | "Медиа" | "Блоки";
  label: string;
  hint: string;
  /** `%s` marks where the selection is wrapped (see applySnippet). */
  snippet: string;
  placeholder: string;
}

export const SNIPPETS: SnippetDef[] = [
  {
    group: "Врезки",
    label: "Совет",
    hint: "Зелёная врезка с подсказкой (обернёт выделение)",
    snippet: '\n:::callout{type="tip"}\n%s\n:::\n',
    placeholder: "Текст совета.",
  },
  {
    group: "Врезки",
    label: "Важное",
    hint: "Жёлтая врезка-акцент (обернёт выделение)",
    snippet: '\n:::callout{type="important"}\n%s\n:::\n',
    placeholder: "Важный текст.",
  },
  {
    group: "Врезки",
    label: "Предупреждение",
    hint: "Красная врезка-предостережение (обернёт выделение)",
    snippet: '\n:::callout{type="warning"}\n%s\n:::\n',
    placeholder: "Предупреждение.",
  },
  {
    group: "Врезки",
    label: "Материал",
    hint: "Серая врезка со ссылками на источники (обернёт выделение)",
    snippet: '\n:::callout{type="material"}\n%s\n:::\n',
    placeholder: "- [Ссылка](https://)",
  },
  {
    group: "Медиа",
    label: "Видео",
    hint: "Встроенный YouTube-плеер",
    snippet: '\n:::video{url="https://youtu.be/..." title="Название"}\n:::\n',
    placeholder: "",
  },
  {
    group: "Медиа",
    label: "Практика",
    hint: "Блок практических заданий (обернёт выделение)",
    snippet: "\n:::practice\n%s\n:::\n",
    placeholder: "- [Задание](https://)",
  },
  {
    group: "Медиа",
    label: "Мок-интервью",
    hint: "CTA «Забронировать мок» (legend / theory)",
    snippet: '\n:::mock{type="legend"}\n:::\n',
    placeholder: "",
  },
  {
    group: "Блоки",
    label: "Код",
    hint: "Подсветка Shiki (обернёт выделение)",
    snippet: "\n```python\n%s\n```\n",
    placeholder: 'print("hello")',
  },
  {
    // D5 (spec 13.1): inline formula $…$ with the caret inside (no $$-block).
    group: "Блоки",
    label: "Формула",
    hint: "Инлайн-формула $…$ (курсор внутри; обернёт выделение)",
    snippet: "$%s$",
    placeholder: "",
  },
  {
    group: "Блоки",
    label: "Таблица",
    hint: "GFM-таблица (скроллится по горизонтали)",
    snippet: "\n| Колонка | Колонка |\n| --- | --- |\n| Ячейка | Ячейка |\n",
    placeholder: "",
  },
];

/** Labels the guide editor offers (guides have no mock CTA / warning callout). */
export const GUIDE_SNIPPET_LABELS = new Set([
  "Совет",
  "Важное",
  "Материал",
  "Видео",
  "Практика",
  "Код",
  "Формула",
  "Таблица",
]);

export function snippetsFor(zone: "lesson" | "guide"): SnippetDef[] {
  return zone === "lesson" ? SNIPPETS : SNIPPETS.filter((s) => GUIDE_SNIPPET_LABELS.has(s.label));
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One matcher per insert template, plus the blank lines around it. Line breaks
 * inside a template are matched as `\n\s*` so a stored block that gained a blank
 * line before a list placeholder (older snippet versions did that) still
 * matches — while every non-whitespace character, including the placeholder text
 * itself, must still be identical.
 *
 * `$%s$` and the table template are excluded on purpose: an empty `$$` is not a
 * recognisable block, and a template table is indistinguishable from a real
 * two-column table — removing either could delete real content.
 */
function placeholderMatchers(): Array<{ label: string; re: RegExp }> {
  const rendered = SNIPPETS.filter(
    (s) =>
      (s.snippet.startsWith("\n:::") || s.snippet.includes("```")) &&
      // «Мок-интервью» is EXCLUDED. Every other template is recognisable because
      // its body is still the placeholder text; an empty `:::mock{type="legend"}`
      // has no body, so an accidental insert is byte-identical to a deliberate
      // one — and the importer prepends exactly that block to soft-skills lessons
      // (notion-import/plan.ts), where mocks.ts greps for it to auto-complete the
      // lesson after a booking. A stand dry-run caught this trying to delete
      // three real mock lessons.
      s.label !== "Мок-интервью",
  ).map((s) => ({ label: s.label, text: s.snippet.replace("%s", s.placeholder).trim() }));

  // Legacy: an earlier «Формула» button inserted a $$-block with this sample
  // (see the D5 note); the welcome lesson still carries two of them.
  rendered.push({ label: "Формула (устаревший $$-блок)", text: "$$\nE = mc^2\n$$" });

  return rendered
    .filter((r) => r.text.length > 0)
    .map((r) => ({
      label: r.label,
      // \n*\s* on both sides swallows the surrounding blank lines with the block.
      re: new RegExp(`\\n*${r.text.split("\n").map(escapeRe).join("\\n\\s*")}\\n*`, "g"),
    }));
}

export interface StripResult {
  content: string;
  /** Which templates were removed and how many of each. */
  removed: Array<{ block: string; count: number }>;
}

/**
 * Removes untouched insert-template blocks (walk 13.6 block 1.5). Deliberately
 * conservative: a block is dropped ONLY if every non-whitespace character matches
 * a template — including its placeholder text — so edited blocks and real content
 * are never touched. Orphan lone `$` lines (a half-typed formula) also go.
 */
export function stripPlaceholderBlocks(markdown: string): StripResult {
  let out = markdown;
  const removed: Array<{ block: string; count: number }> = [];

  for (const { label, re } of placeholderMatchers()) {
    const hits = out.match(re);
    if (!hits?.length) continue;
    out = out.replace(re, "\n\n");
    removed.push({ block: label, count: hits.length });
  }

  const loneDollars = out.match(/^[ \t]*\$[ \t]*$/gm);
  if (loneDollars?.length) {
    out = out.replace(/^[ \t]*\$[ \t]*$\n?/gm, "");
    removed.push({ block: "$ (одинокая строка)", count: loneDollars.length });
  }

  // Normalise: no leading blank lines, at most one blank line between blocks.
  out = out.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  return { content: out.trimEnd() + "\n", removed };
}
