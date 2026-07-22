// D5 (spec 13.1): pure snippet-insert logic shared by the lesson and guide
// editors. `%s` in a snippet marks where the current selection is wrapped (or the
// `placeholder` when nothing is selected); the wrapped text is re-selected. A
// snippet without `%s` (video/table/mock) is inserted at the END of the selection
// so nothing is ever discarded. Kept pure so the wrap behaviour is unit-testable.

export interface SnippetDef {
  snippet: string;
  placeholder: string;
}

export interface InsertResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

export function applySnippet(
  content: string,
  start: number,
  end: number,
  def: SnippetDef,
): InsertResult {
  const selected = content.slice(start, end);
  const markerIdx = def.snippet.indexOf("%s");

  if (markerIdx === -1) {
    // No wrap point: append after the selection so selected text is preserved.
    const at = end;
    const next = content.slice(0, at) + def.snippet + content.slice(at);
    const caret = at + def.snippet.length;
    return { content: next, selectionStart: caret, selectionEnd: caret };
  }

  const body = selected || def.placeholder;
  const text = def.snippet.slice(0, markerIdx) + body + def.snippet.slice(markerIdx + 2);
  const next = content.slice(0, start) + text + content.slice(end);
  const selStart = start + markerIdx;
  const selEnd = selStart + body.length;
  return { content: next, selectionStart: selStart, selectionEnd: selEnd };
}
