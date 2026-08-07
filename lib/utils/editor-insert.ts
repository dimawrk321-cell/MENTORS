// D5 (spec 13.1): pure snippet-insert logic shared by the lesson and guide
// editors. `%s` in a snippet marks where the current selection is wrapped (or the
// `placeholder` when nothing is selected); the wrapped text is re-selected.
//
// Заход «Редактор блоков»: три правки контракта, все из воспроизведённого бага
// владельца (вставил «Код», следом «Важное» — врезка уехала ВНУТРЬ code-фенса и
// отрендерилась сырым `:::` текстом).
//
//   1. БЛОЧНЫЙ СНИППЕТ НЕ ВКЛАДЫВАЕТСЯ. Обернуть выделение врезкой — по-прежнему
//      рабочий приём (решение D5), но только когда выделение лежит в прозе.
//      Если оно внутри фенса, `:::`-контейнера или таблицы, вставка уходит НА
//      ГРАНИЦУ этой конструкции: директива внутри директивы невозможна в
//      принципе, а не «если ментор аккуратен».
//   2. ИЗОЛЯЦИЯ СЧИТАЕТСЯ, А НЕ ХАРДКОДИТСЯ. Раньше края `\n` были зашиты в сам
//      шаблон и складывались с уже существующими переводами строк (в документе
//      заводились `\n\n\n`). Теперь края шаблона срезаются, а пустые строки
//      добиваются по фактическому окружению — ровно одна с каждой стороны.
//   3. ИНЛАЙНОВЫЙ СНИППЕТ (`$%s$`) НЕ ТРОГАЕТСЯ: у него нет переводов строк, он
//      живёт внутри абзаца и вкладываться ему некуда.
//
// Kept pure so all three are unit-testable.

export interface SnippetDef {
  snippet: string;
  placeholder: string;
}

export interface InsertResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

const FENCE_EDGE = /^\s{0,3}(```|~~~)/;
const DIRECTIVE_OPEN = /^\s{0,3}:::\S/;
const DIRECTIVE_CLOSE = /^\s{0,3}:::\s*$/;
const TABLE_ROW = /^\s{0,3}\|/;

interface LineSpan {
  /** Offset of the line's first character. */
  start: number;
  /** Offset of the line's last character + 1 (the newline is NOT included). */
  end: number;
  text: string;
}

function lineSpans(content: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (;;) {
    const nl = content.indexOf("\n", start);
    const end = nl === -1 ? content.length : nl;
    spans.push({ start, end, text: content.slice(start, end) });
    if (nl === -1) break;
    start = nl + 1;
  }
  return spans;
}

function lineIndexAt(spans: readonly LineSpan[], offset: number): number {
  for (let i = 0; i < spans.length; i += 1) {
    if (offset <= spans[i]!.end) return i;
  }
  return spans.length - 1;
}

/**
 * Конец блочной конструкции, ВНУТРИ которой стоит offset, или null, если он в
 * прозе. Конструкции: фенс (``` / ~~~), `:::`-контейнер, таблица GFM.
 *
 * «Внутри» — это и строки тела, и сами маркеры: вставлять между открывающим
 * `:::` и его телом так же неправильно, как в середину.
 */
function enclosingBlockEnd(content: string, offset: number): number | null {
  const spans = lineSpans(content);
  const target = lineIndexAt(spans, offset);

  let fenceFrom: number | null = null;
  let directiveFrom: number | null = null;
  let tableFrom: number | null = null;

  for (let i = 0; i < spans.length; i += 1) {
    const line = spans[i]!.text;

    if (fenceFrom !== null) {
      if (FENCE_EDGE.test(line)) {
        if (target >= fenceFrom && target <= i) return spans[i]!.end;
        fenceFrom = null;
      }
      continue;
    }
    if (directiveFrom !== null) {
      if (DIRECTIVE_CLOSE.test(line)) {
        if (target >= directiveFrom && target <= i) return spans[i]!.end;
        directiveFrom = null;
      }
      continue;
    }

    if (FENCE_EDGE.test(line)) {
      fenceFrom = i;
      tableFrom = null;
      continue;
    }
    if (DIRECTIVE_OPEN.test(line)) {
      directiveFrom = i;
      tableFrom = null;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      tableFrom ??= i;
      const last = i === spans.length - 1 || !TABLE_ROW.test(spans[i + 1]!.text);
      if (last) {
        if (target >= tableFrom && target <= i) return spans[i]!.end;
        tableFrom = null;
      }
      continue;
    }
    tableFrom = null;
  }

  // Незакрытая конструкция тянется до конца документа — вставляем за ней.
  const open = fenceFrom ?? directiveFrom;
  if (open !== null && target >= open) return content.length;
  return null;
}

/** Конец строки, на которой стоит offset (перевод строки не включается). */
function lineEnd(content: string, offset: number): number {
  const nl = content.indexOf("\n", offset);
  return nl === -1 ? content.length : nl;
}

function substitute(snippet: string, markerIdx: number, body: string): string {
  return snippet.slice(0, markerIdx) + body + snippet.slice(markerIdx + 2);
}

export function applySnippet(
  content: string,
  start: number,
  end: number,
  def: SnippetDef,
): InsertResult {
  const selected = content.slice(start, end);
  // Блочность читается по краевым `\n` ИСХОДНОГО шаблона: автор ставит их именно
  // затем, чтобы блок встал на свою строку. Считать по «есть ли перевод строки
  // внутри» нельзя — однострочная заготовка таблицы (`\n| A | B |\n`) блочная,
  // а внутри переводов не имеет.
  const isBlock = /^\n/.test(def.snippet) || /\n$/.test(def.snippet);
  // Края срезаются: изоляция считается ниже по фактическому окружению.
  const snippet = def.snippet.replace(/^\n+/, "").replace(/\n+$/, "");
  const markerIdx = snippet.indexOf("%s");

  // --- Инлайн ($…$): поведение D5 без изменений. ---
  if (!isBlock) {
    if (markerIdx === -1) {
      const next = content.slice(0, end) + snippet + content.slice(end);
      const caret = end + snippet.length;
      return { content: next, selectionStart: caret, selectionEnd: caret };
    }
    const body = selected || def.placeholder;
    const text = substitute(snippet, markerIdx, body);
    const next = content.slice(0, start) + text + content.slice(end);
    const selStart = start + markerIdx;
    return { content: next, selectionStart: selStart, selectionEnd: selStart + body.length };
  }

  // --- Блочный сниппет. ---
  // Обернуть выделение можно только в прозе: внутри другой конструкции это
  // породило бы директиву в директиве (баг владельца).
  const inside = enclosingBlockEnd(content, start) ?? enclosingBlockEnd(content, end);
  const wraps = markerIdx !== -1 && selected !== "" && inside === null;

  let from: number;
  let to: number;
  let body: string;
  if (wraps) {
    from = start;
    to = end;
    body = selected;
  } else {
    from = to = inside ?? lineEnd(content, end);
    body = def.placeholder;
  }

  const text = markerIdx === -1 ? snippet : substitute(snippet, markerIdx, body);

  // Ровно одна пустая строка с каждой стороны — считаем по окружению.
  // На шве срезается и горизонтальный пробел: выдёргивая фрагмент из середины
  // предложения, мы оставили бы висеть «до ␣» и «␣после». На хвосте пробелы
  // снимаются ТОЛЬКО с той же строки (до первого перевода) — иначе съелся бы
  // отступ следующего вложенного списка или indented-кода.
  const head = content.slice(0, from).replace(/[ \t\n]+$/, "");
  const tail = content
    .slice(to)
    .replace(/^[ \t]+/, "")
    .replace(/^\n+/, "");
  const prefix = head === "" ? "" : `${head}\n\n`;
  const suffix = tail === "" ? "\n" : `\n\n${tail}`;
  const next = prefix + text + suffix;

  if (markerIdx === -1) {
    const caret = prefix.length + text.length;
    return { content: next, selectionStart: caret, selectionEnd: caret };
  }
  const selStart = prefix.length + markerIdx;
  return { content: next, selectionStart: selStart, selectionEnd: selStart + body.length };
}
