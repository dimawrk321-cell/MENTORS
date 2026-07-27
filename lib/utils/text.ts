// Plain-text teaser out of markdown for catalog cards and admin tables.
// Not a parser — just enough cleanup for a one-line preview.

/** Catalog row teaser cap (walk 13.5 block 1.2/1.3): «~80 символов». */
export const CATALOG_TEASER_MAX = 80;

/**
 * Catalog row teaser (walk 13.5): whole stripped text for a short question
 * (≤ CATALOG_TEASER_MAX — the summary IS the full question, expand shows only the
 * эталон), else ~80 chars cut at a word boundary with «…». Shared by the catalog
 * page (row summary) and the lazy-answer service (decides if the full question
 * must be rendered in the expanded panel) so both agree on «short».
 */
export function catalogTeaser(markdown: string): { teaser: string; isShort: boolean } {
  const full = stripMarkdown(markdown, 100_000) || "Без текста";
  if (full.length <= CATALOG_TEASER_MAX) return { teaser: full, isShort: true };
  const slice = full.slice(0, CATALOG_TEASER_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > CATALOG_TEASER_MAX * 0.6 ? slice.slice(0, lastSpace) : slice;
  return { teaser: `${cut.trimEnd()}…`, isShort: false };
}

export function stripMarkdown(markdown: string, maxLength = 160): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/:::[a-z]*\{[^}]*\}|:::/g, " ")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  // Back up to the last word boundary so titles/teasers are not cut mid-word
  // (spec 13.1/A2). Only when a space sits reasonably close to the limit —
  // otherwise a single very long token would collapse the teaser to nothing.
  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}
