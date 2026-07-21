// Markdown block normalizer (walk 12.3, P3a). Fixes the imported-content render
// bug where headings render as literal «### …» and links as bare «[url](url)».
//
// ROOT CAUSE: the Notion export nests a section's body deeper than its heading.
// `nodeBody`/`dedent` (parser.ts) strips only the *global common-minimum* indent,
// so every line indented deeper keeps a residual of ≥4 spaces — which CommonMark
// treats as an INDENTED CODE BLOCK. Headings, links, lists, GFM tables and fenced
// code inside that block then render as literal text.
//
// The fix re-indents each line to a canonical list-nesting level (discarding the
// export's absolute tree indentation) while preserving fenced code and GFM tables
// verbatim, and guarantees a blank separator before block starts. It is
// idempotent: normalizing already-normalized markdown returns it unchanged — the
// property the repair script (scripts/normalize-imported-md.ts) relies on.

/** Canonical indent for a given list-nesting depth (2 spaces per level). */
function indentFor(depth: number): string {
  return "  ".repeat(Math.max(0, depth));
}

/**
 * Re-indents markdown to canonical block structure, killing accidental
 * indented-code-blocks introduced by the Notion export's deep tree indentation.
 * Fenced code (``` … ```) and GFM table rows keep their content; list nesting is
 * recomputed from the sequence of markers, not from absolute indentation.
 */
export function normalizeImportedMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const listStack: number[] = []; // raw indents of currently-open list levels
  let fence: { rawIndent: number; base: string } | null = null;

  const sep = () => {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  };

  for (const rawLine of lines) {
    // --- inside a fenced code block: pass through, preserving relative indent ---
    if (fence) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith("```")) {
        out.push(fence.base + "```");
        fence = null;
      } else {
        const indent = rawLine.length - rawLine.trimStart().length;
        const rel = Math.max(0, indent - fence.rawIndent);
        out.push(fence.base + " ".repeat(rel) + rawLine.trimStart());
      }
      continue;
    }

    if (rawLine.trim() === "") {
      out.push("");
      continue;
    }

    const raw = rawLine.length - rawLine.trimStart().length;
    const content = rawLine.trimStart();

    // --- fenced code open ---
    if (content.startsWith("```")) {
      const base = indentFor(listStack.length);
      sep();
      out.push(base + content);
      fence = { rawIndent: raw, base };
      continue;
    }

    // --- heading / thematic break: top-level block, closes any open list ---
    if (/^#{1,6}\s/.test(content) || /^(\*\*\*+|---+|___+)\s*$/.test(content)) {
      listStack.length = 0;
      sep();
      out.push(content);
      continue;
    }

    // --- list item: nesting depth from the marker sequence, not raw indent ---
    const marker = /^([-*+]|\d+[.)])\s+/.exec(content);
    if (marker) {
      while (listStack.length > 0 && listStack[listStack.length - 1]! >= raw) listStack.pop();
      const startingNewList = listStack.length === 0;
      listStack.push(raw);
      if (startingNewList) sep();
      out.push(indentFor(listStack.length - 1) + content);
      continue;
    }

    // --- GFM table row ---
    if (content.startsWith("|")) {
      const prev = out[out.length - 1];
      const continuingTable = prev !== undefined && prev.trimStart().startsWith("|");
      if (!continuingTable) sep();
      out.push(indentFor(listStack.length) + content);
      continue;
    }

    // --- paragraph / other text ---
    if (listStack.length > 0 && raw > listStack[listStack.length - 1]!) {
      // deeper than the current marker → continuation of that list item
      out.push(indentFor(listStack.length) + content);
    } else {
      listStack.length = 0;
      out.push(content);
    }
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
