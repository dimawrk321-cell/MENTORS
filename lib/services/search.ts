import type { PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import {
  GUIDE_SECTION_LABEL,
  LESSON_DIFFICULTY_LABEL,
  QUESTION_TYPE_LABEL,
  RECORDING_OUTCOME_LABEL,
  SEARCH_GROUP_LIMIT,
  recordingCardTitle,
} from "@/lib/constants";
import { stripMarkdown } from "@/lib/utils/text";

// Search service (spec 7.11 / 6 «FTS»). Pure over `db` so it is unit-testable
// against the test database. Postgres FTS (`russian`) over lessons/questions/
// guides/recordings with a pg_trgm title fallback for typos. Ranking ts_rank,
// 5 per group, ts_headline highlighting.
//
// DECISION (spec 7.11): lessons are searchable regardless of course gating —
// everything published is findable; the lock only bites on navigation to a
// still-locked lesson. This is intentional so search never hides content.
//
// DECISION (spec 7.11): the library group is included only when the caller's
// user has library_enabled — the per-student toggle (spec 7.9) gates search too.

export type SearchGroupType = "lessons" | "questions" | "guides" | "recordings";

export interface SearchItem {
  id: string;
  title: string;
  /** HTML string — ONLY <mark> tags, content is HTML-escaped (see renderSnippet). */
  snippet: string;
  url: string;
  meta: string;
}

export interface SearchGroup {
  type: SearchGroupType;
  items: SearchItem[];
}

export interface SearchResult {
  groups: SearchGroup[];
  /** true when the trgm fallback produced the results («Возможно, вы искали»). */
  fuzzy: boolean;
}

export interface SearchInput {
  q: string;
  /** Per-student library toggle (spec 7.9); false hides the recordings group. */
  libraryEnabled: boolean;
  /**
   * Per-student guides section access (spec 12.1/C3): false hides that section.
   * Optional — omitted means full access (used by tests); real callers pass the
   * user's flags so a disabled section never appears in search.
   */
  guidesResumeEnabled?: boolean;
  guidesLegendEnabled?: boolean;
  /**
   * A1 (spec 13.1): the viewer is staff (mentor/admin/owner). Result URLs are
   * then rewritten to content-studio destinations (editor/preview) instead of
   * the student pages — otherwise a staff click lands on `requireStudentZone`,
   * which bounces to the Пульт. Default false (student).
   */
  staff?: boolean;
}

/** Sections the caller may see — filters resume/legend out of guide search (C3). */
interface GuideSectionAccess {
  resume: boolean;
  legend: boolean;
}

// --- Snippet safety (spec 7.11: «отдавать готовый HTML только из ts_headline») ---

// ts_headline wraps matches in these control-char sentinels (STX/ETX). They can
// never appear in real content and survive HTML-escaping unchanged, so we escape
// the whole snippet first (neutralising any HTML/markdown in the source) and only
// then swap the sentinels for <mark>. The result is safe to render as HTML.
const HL_START = "";
const HL_END = "";

const HEADLINE_OPTS =
  `StartSel=${HL_START},StopSel=${HL_END},` +
  `MaxFragments=2,MaxWords=14,MinWords=5,ShortWord=2,FragmentDelimiter=" … "`;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A2 (spec 13.1): ts_headline highlights over the RAW markdown column, so the
// fragment carries literal markup (**жирный**, [текст](url), link guts, #, :::
// directives). Strip it to plain text BEFORE escaping, keeping the STX/ETX
// highlight sentinels (/) intact. Char classes below explicitly
// balance the sentinels afterwards, so a URL removal can't orphan a <mark>.
function stripSnippetMarkdown(text: string): string {
  return (
    text
      // images → keep alt text; markdown links → keep visible text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // orphan link guts left by a truncated fragment: `](url`, `(https://…`, bare URLs
      .replace(/\]\((?:https?:\/\/)?[^)\s]*\)?/g, "")
      .replace(/\((?:https?:\/\/)[^)\s]*\)?/g, "")
      .replace(/https?:\/\/[^\s]+/g, "")
      .replace(/[[\]]/g, "")
      // directive fences (:::callout{...}, :::video, closing :::)
      .replace(/:::\s*[a-z]+(?:\{[^}]*\})?/gi, "")
      .replace(/:::/g, "")
      // heading / blockquote markers at a fragment or line start
      .replace(/(^|[\n\s…])#{1,6}\s+/g, "$1")
      .replace(/(^|\n)>\s?/g, "$1")
      // emphasis / inline-code / strike / table pipes
      .replace(/\*\*|\*|`|~~|~|\|/g, "")
      // collapse the whitespace the removals leave behind
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:!?…])/g, "$1")
      .trim()
  );
}

// Drop unmatched highlight sentinels so renderSnippet always yields balanced
// <mark></mark> (a strip can orphan a sentinel that sat inside a removed URL).
// ts_headline never nests highlights, so a single open/close depth is enough.
function balanceSentinels(s: string): string {
  const out: string[] = [];
  let openIdx = -1;
  for (const ch of s) {
    if (ch === HL_START) {
      if (openIdx === -1) {
        out.push(ch);
        openIdx = out.length - 1;
      }
    } else if (ch === HL_END) {
      if (openIdx !== -1) {
        out.push(ch);
        openIdx = -1;
      }
    } else {
      out.push(ch);
    }
  }
  if (openIdx !== -1) out.splice(openIdx, 1);
  return out.join("");
}

/** Strip markdown to clean text, then escape and reveal only the <mark> highlights. */
export function renderSnippet(raw: string): string {
  const clean = balanceSentinels(stripSnippetMarkdown(raw));
  return escapeHtml(clean).split(HL_START).join("<mark>").split(HL_END).join("</mark>");
}

// --- FTS queries (one per entity; each rides its GIN index) ---

interface LessonRow {
  id: string;
  title: string;
  snippet: string;
  reading: number;
  difficulty: string;
}

async function searchLessons(db: Db, q: string): Promise<SearchItem[]> {
  const rows = await db.$queryRaw<LessonRow[]>`
    SELECT l.id,
           l.title,
           ts_headline('russian', l.content_md, query, ${HEADLINE_OPTS}) AS snippet,
           l.reading_minutes AS reading,
           l.difficulty::text AS difficulty,
           ts_rank(l.search_vector, query) AS rank
    FROM lessons l, websearch_to_tsquery('russian', ${q}) query
    WHERE l.status = 'published' AND l.search_vector @@ query
    ORDER BY rank DESC, l.id
    LIMIT ${SEARCH_GROUP_LIMIT}`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: renderSnippet(r.snippet),
    url: `/lessons/${r.id}`,
    meta: `${r.reading} мин · ${LESSON_DIFFICULTY_LABEL[r.difficulty] ?? r.difficulty}`,
  }));
}

interface QuestionRow {
  id: string;
  text_md: string;
  snippet: string;
  category: string;
  type: string;
}

async function searchQuestions(db: Db, q: string): Promise<SearchItem[]> {
  const rows = await db.$queryRaw<QuestionRow[]>`
    SELECT q.id,
           left(q.text_md, 200) AS text_md,
           ts_headline('russian', coalesce(q.answer_md, '') || ' ' || q.text_md, query, ${HEADLINE_OPTS}) AS snippet,
           c.title AS category,
           q.type::text AS type
    FROM questions q
    JOIN question_categories c ON c.id = q.category_id,
         websearch_to_tsquery('russian', ${q}) query
    WHERE q.status = 'published' AND q.search_vector @@ query
    ORDER BY ts_rank(q.search_vector, query) DESC, q.id
    LIMIT ${SEARCH_GROUP_LIMIT}`;
  return rows.map((r) => ({
    id: r.id,
    title: stripMarkdown(r.text_md, 100),
    snippet: renderSnippet(r.snippet),
    url: `/questions/${r.id}`,
    meta: `${r.category} · ${QUESTION_TYPE_LABEL[r.type] ?? r.type}`,
  }));
}

interface GuideRow {
  id: string;
  slug: string;
  title: string;
  snippet: string;
  section: string;
}

async function searchGuides(db: Db, q: string, allow: GuideSectionAccess): Promise<SearchItem[]> {
  const rows = await db.$queryRaw<GuideRow[]>`
    SELECT g.id,
           g.slug,
           g.title,
           ts_headline('russian', g.content_md, query, ${HEADLINE_OPTS}) AS snippet,
           g.section::text AS section,
           ts_rank(g.search_vector, query) AS rank
    FROM guides g, websearch_to_tsquery('russian', ${q}) query
    WHERE g.status = 'published' AND g.search_vector @@ query
      AND (${allow.resume} OR g.section <> 'resume')
      AND (${allow.legend} OR g.section <> 'legend')
    ORDER BY rank DESC, g.id
    LIMIT ${SEARCH_GROUP_LIMIT}`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: renderSnippet(r.snippet),
    url: `/guides/${r.slug}`,
    meta: GUIDE_SECTION_LABEL[r.section] ?? r.section,
  }));
}

interface RecordingRow {
  id: string;
  title: string;
  snippet: string;
  stage: string;
  direction: string;
  grade: string;
  outcome: string;
}

async function searchRecordings(db: Db, q: string): Promise<SearchItem[]> {
  const rows = await db.$queryRaw<RecordingRow[]>`
    SELECT r.id,
           r.title,
           ts_headline('russian', r.title, query, ${HEADLINE_OPTS}) AS snippet,
           r.stage::text AS stage,
           r.direction::text AS direction,
           r.grade::text AS grade,
           r.outcome::text AS outcome,
           ts_rank(r.search_vector, query) AS rank
    FROM recordings r, websearch_to_tsquery('russian', ${q}) query
    WHERE r.status = 'published' AND r.search_vector @@ query
    ORDER BY rank DESC, r.id
    LIMIT ${SEARCH_GROUP_LIMIT}`;
  return rows.map((r) => ({
    id: r.id,
    // Anonymized label is the student-facing title (spec 7.9); the matched raw
    // title shows highlighted in the snippet.
    title: recordingCardTitle(r),
    snippet: renderSnippet(r.snippet),
    url: `/library/${r.id}`,
    meta: RECORDING_OUTCOME_LABEL[r.outcome] ?? r.outcome,
  }));
}

// --- Trgm fallback (spec 7.11: FTS empty → similarity > 0.3 on the title) ---

// DECISION (spec 7.11): the fallback uses word_similarity, not whole-string
// similarity. A typo is usually one misspelled keyword, and whole-string
// similarity of a short query against a multi-word title is heavily diluted
// («градент» vs «Градиентный спуск» ≈ 0.15). word_similarity(query, field) scores
// the query against the best-matching word window, so «> 0.3» actually fires on
// real typos. `q <% field` rides the pg_trgm GIN index; the threshold is set to
// 0.3 per-transaction (SET LOCAL) and the explicit `word_similarity() > 0.3`
// keeps the cutoff strict. Runs only when FTS is empty (rare).
//
// NOTE: pg_trgm keys word-char detection off the database LC_CTYPE. Under a `C`
// locale it extracts NO Cyrillic trigrams, so this fallback returns empty (never
// errors) — search stays fully functional via FTS. The DB must use a
// Cyrillic-aware ctype (e.g. ru-RU / *.UTF-8) for typo tolerance; see the stage 8
// report and tests/global-setup.ts.
interface TitleTrgmRow {
  id: string;
  title: string;
  slug?: string;
}

async function fuzzyLessons(db: Db, q: string): Promise<SearchItem[]> {
  const rows = await db.$queryRaw<TitleTrgmRow[]>`
    SELECT l.id, l.title
    FROM lessons l
    WHERE l.status = 'published' AND ${q} <% l.title AND word_similarity(${q}, l.title) > 0.3
    ORDER BY word_similarity(${q}, l.title) DESC, l.id
    LIMIT ${SEARCH_GROUP_LIMIT}`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: "",
    url: `/lessons/${r.id}`,
    meta: "",
  }));
}

async function fuzzyGuides(db: Db, q: string, allow: GuideSectionAccess): Promise<SearchItem[]> {
  const rows = await db.$queryRaw<TitleTrgmRow[]>`
    SELECT g.id, g.title, g.slug
    FROM guides g
    WHERE g.status = 'published' AND ${q} <% g.title AND word_similarity(${q}, g.title) > 0.3
      AND (${allow.resume} OR g.section <> 'resume')
      AND (${allow.legend} OR g.section <> 'legend')
    ORDER BY word_similarity(${q}, g.title) DESC, g.id
    LIMIT ${SEARCH_GROUP_LIMIT}`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: "",
    url: `/guides/${r.slug}`,
    meta: "",
  }));
}

async function fuzzyQuestions(db: Db, q: string): Promise<SearchItem[]> {
  const rows = await db.$queryRaw<{ id: string; text_md: string }[]>`
    SELECT q.id, left(q.text_md, 200) AS text_md
    FROM questions q
    WHERE q.status = 'published' AND ${q} <% q.text_md AND word_similarity(${q}, q.text_md) > 0.3
    ORDER BY word_similarity(${q}, q.text_md) DESC, q.id
    LIMIT ${SEARCH_GROUP_LIMIT}`;
  return rows.map((r) => ({
    id: r.id,
    title: stripMarkdown(r.text_md, 100),
    snippet: "",
    url: `/questions/${r.id}`,
    meta: "",
  }));
}

async function fuzzyRecordings(db: Db, q: string): Promise<SearchItem[]> {
  const rows = await db.$queryRaw<
    { id: string; stage: string; direction: string; grade: string }[]
  >`
    SELECT r.id, r.stage::text AS stage, r.direction::text AS direction, r.grade::text AS grade
    FROM recordings r
    WHERE r.status = 'published' AND ${q} <% r.title AND word_similarity(${q}, r.title) > 0.3
    ORDER BY word_similarity(${q}, r.title) DESC, r.id
    LIMIT ${SEARCH_GROUP_LIMIT}`;
  return rows.map((r) => ({
    id: r.id,
    title: recordingCardTitle(r),
    snippet: "",
    url: `/library/${r.id}`,
    meta: "",
  }));
}

// --- Orchestration ---

function packGroups(parts: Record<SearchGroupType, SearchItem[]>): SearchGroup[] {
  const order: SearchGroupType[] = ["lessons", "questions", "guides", "recordings"];
  return order
    .map((type) => ({ type, items: parts[type] }))
    .filter((group) => group.items.length > 0);
}

// A1 (spec 13.1): where a staff click on a result should land. Keyed by group +
// item.id (SearchItem.id is the entity id for every group, incl. guides whose
// student url uses the slug). Questions have no preview route → the editor;
// recordings have no per-record staff route → the library table.
const STAFF_URL: Record<SearchGroupType, (id: string) => string> = {
  lessons: (id) => `/admin/content/lessons/${id}`,
  questions: (id) => `/admin/questions/${id}`,
  guides: (id) => `/admin/content/guides/${id}`,
  recordings: () => `/admin/library`,
};

/** Rewrite student result URLs to their content-studio equivalents for staff. */
function withStaffUrls(groups: SearchGroup[]): SearchGroup[] {
  return groups.map((group) => ({
    type: group.type,
    items: group.items.map((item) => ({ ...item, url: STAFF_URL[group.type](item.id) })),
  }));
}

/**
 * Run the search (spec 7.11). FTS first; if every group is empty, fall back to a
 * trgm title search flagged `fuzzy`. Recordings are included only when the
 * caller's user has library_enabled. Takes the base client (not a tx client) —
 * it is a read entry point and opens its own tx for the fallback threshold.
 */
export async function search(db: PrismaClient, input: SearchInput): Promise<SearchResult> {
  const q = input.q.trim();
  const allow: GuideSectionAccess = {
    resume: input.guidesResumeEnabled ?? true,
    legend: input.guidesLegendEnabled ?? true,
  };

  const [lessons, questions, guides, recordings] = await Promise.all([
    searchLessons(db, q),
    searchQuestions(db, q),
    searchGuides(db, q, allow),
    input.libraryEnabled ? searchRecordings(db, q) : Promise.resolve<SearchItem[]>([]),
  ]);

  const groups = packGroups({ lessons, questions, guides, recordings });
  if (groups.length > 0) {
    return { groups: input.staff ? withStaffUrls(groups) : groups, fuzzy: false };
  }

  // FTS empty → typo-tolerant fallback. One tx so SET LOCAL scopes the
  // word_similarity threshold to these queries (spec «similarity > 0.3»);
  // queries run sequentially — they share the tx's single connection.
  const fuzzyGroups = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL pg_trgm.word_similarity_threshold = 0.3");
    const fl = await fuzzyLessons(tx, q);
    const fq = await fuzzyQuestions(tx, q);
    const fg = await fuzzyGuides(tx, q, allow);
    const fr = input.libraryEnabled ? await fuzzyRecordings(tx, q) : [];
    return packGroups({ lessons: fl, questions: fq, guides: fg, recordings: fr });
  });
  const staffFuzzy = input.staff ? withStaffUrls(fuzzyGroups) : fuzzyGroups;
  return { groups: staffFuzzy, fuzzy: staffFuzzy.length > 0 };
}
