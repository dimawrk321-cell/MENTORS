// Reading-screen primitives shared by the lesson and the guide (заход «Читалка v2»).
//
// Everything here is PURE and DOM-free on purpose: the reading progress bar, the
// scroll-spy table of contents and the 01/02/03 section numbering all derive from
// these functions, so the behaviour is unit-testable in the node test environment
// (the repo has no jsdom — see vitest.config.ts) and the client hook stays a thin
// listener around them.
//
// The heading shape is declared structurally rather than imported from
// lib/utils/markdown: that module pulls the whole unified/remark/shiki pipeline,
// and a value-import from a client component would drag it into the browser
// bundle (see the stage-10 note in the changelog about server-module leaks).

export interface ReadingHeading {
  id: string;
  text: string;
  depth: number;
}

export interface TocEntry extends ReadingHeading {
  /** Top-level heading of this document (vs a nested one) — drives the indent. */
  isSection: boolean;
}

/** Reading line used by the scroll-spy: sticky header (52) + breathing room. */
export const SCROLL_SPY_OFFSET = 96;

/**
 * The heading depth that counts as a top-level «раздел» of the document.
 *
 * Most imported Notion content has NO h2 at all and structures itself with h3
 * (63 of 85 lessons, 20 of 22 guides in the current base), so keying the table
 * of contents strictly on H2 would silently flatten it. The shallowest depth
 * present is the document's own section level; a document without headings has
 * none.
 */
export function sectionDepth(headings: readonly ReadingHeading[]): number | null {
  let min: number | null = null;
  for (const heading of headings) {
    if (min === null || heading.depth < min) min = heading.depth;
  }
  return min;
}

/**
 * Headings in document order, each marked as a top-level section or a nested
 * one — the table of contents only uses this to indent.
 *
 * DECISION (решение владельца): порядковых номеров 01/02/03 здесь НЕТ и в
 * читалке они не рисуются. Импортированный контент почти весь пронумерован
 * руками прямо в тексте заголовка («1. Базовый минимум…»), и автонумерация
 * давала вторую, конфликтующую.
 */
export function buildToc(headings: readonly ReadingHeading[]): TocEntry[] {
  const level = sectionDepth(headings);
  return headings.map((heading) => ({
    ...heading,
    isSection: level !== null && heading.depth === level,
  }));
}

/**
 * How far the document is read, 0..1. A document that fits the viewport has
 * nothing left to read, so it reports 1 rather than 0 (the bar and the «прочитано
 * N%» label must not claim a short guide is unread).
 */
export function readingFraction(
  scrollY: number,
  scrollHeight: number,
  viewportHeight: number,
): number {
  const max = scrollHeight - viewportHeight;
  if (!(max > 0)) return 1;
  const fraction = scrollY / max;
  if (!Number.isFinite(fraction)) return 0;
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
}

/** 0..1 → 0..100, clamped; NaN reads as 0. */
export function readingPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  return Math.round(clamped * 100);
}

export interface HeadingOffset {
  id: string;
  /** Document-space offset of the heading top, in px. */
  top: number;
}

/**
 * Scroll-spy: the last heading whose top has crossed the reading line.
 *
 * Before the first heading (the lead paragraph) the first section stays active —
 * an empty highlight reads as a broken table of contents. At the very bottom the
 * last heading wins even if its own top never reaches the line, which happens
 * whenever the closing section is shorter than the viewport.
 */
export function activeHeadingId(
  offsets: readonly HeadingOffset[],
  scrollY: number,
  offset: number = SCROLL_SPY_OFFSET,
  atEnd: boolean = false,
): string | null {
  const first = offsets[0];
  const last = offsets[offsets.length - 1];
  if (first === undefined || last === undefined) return null;
  if (atEnd) return last.id;
  const line = scrollY + offset;
  let active: HeadingOffset | null = null;
  for (const candidate of offsets) {
    if (candidate.top <= line && (active === null || candidate.top >= active.top)) {
      active = candidate;
    }
  }
  return (active ?? first).id;
}
