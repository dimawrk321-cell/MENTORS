// Block segmentation over the markdown source (walk 13.6 block 1).
//
// DECISION: a segmented block wrapper over the SAME markdown string — not
// CodeMirror widgets, and not a WYSIWYG (Tiptap stays out, see changelog 13.6).
// Rationale: zero new dependencies, the storage format and the single render
// path are untouched, and — decisive — byte fidelity is guaranteed *by
// construction* rather than by a serializer we have to trust:
//
//   • parse() splits the source into segments whose `raw` slices concatenate
//     back to the original string EXACTLY (no normalisation anywhere);
//   • serialize() emits `raw` for every untouched block, so an unedited
//     document is written back byte-identical;
//   • a recognised block is only offered a visual editor when re-rendering its
//     own parsed fields reproduces its `raw` character for character. A block
//     that fails that check is downgraded to raw text, so editing it can never
//     rewrite bytes the mentor did not touch.
//
// Byte fidelity is not cosmetic here: content-admin.saveLessonContent notifies
// every student who completed a published lesson whenever contentMd differs, so
// a lossy serializer would spam students the moment a mentor opened a lesson.
// lib/services/mocks.ts also greps `:::mock{...type="legend"}` out of the raw
// markdown, so the mock attributes must stay inside the same braces.

export type BlockKind =
  | "prose"
  | "code"
  | "callout"
  | "video"
  | "practice"
  | "mock"
  | "math"
  | "table"
  // Заход B.1: «Скрытый ответ» и вопрос из банка внутри текста урока.
  | "spoiler"
  | "question";

export type CalloutType = "tip" | "important" | "warning" | "material";

export interface Block {
  id: string;
  kind: BlockKind;
  /** Exact source slice. Concatenating every raw reproduces the input. */
  raw: string;
  /** Body text for the kinds that have one (callout/code/practice/math/prose/table). */
  body: string;
  /** callout type / mock type. */
  variant: string;
  /** code fence language. */
  lang: string;
  /** video url + title; title — ещё и заголовок «Скрытого ответа». */
  url: string;
  title: string;
  /** id вопроса из банка для `:::question{id="…"}`. */
  questionId: string;
  /**
   * false when re-rendering the parsed fields would not reproduce `raw`; such a
   * block is edited as plain text so no bytes shift underneath the mentor.
   */
  editable: boolean;
  /** Editing-session flag: true once the mentor changed this block. */
  dirty?: boolean;
  /**
   * Exact trailing terminator of the block's last line ("\n", "\r\n" or "" for a
   * block that ends the document). Re-rendering reuses it, so a block at EOF is
   * not gratuitously given a newline it never had — otherwise that block would
   * fail its round-trip check and be demoted to raw text.
   */
  eol: string;
}

const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/;
const DIRECTIVE_OPEN_RE = /^:::([a-zA-Z][\w-]*)(\{[^}]*\})?[ \t]*$/;
const MATH_OPEN_RE = /^[ \t]*\$\$[ \t]*$/;
const TABLE_ROW_RE = /^[ \t]*\|.*\|[ \t]*$/;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `b${counter}`;
}

function base(kind: BlockKind, raw: string): Block {
  return {
    id: nextId(),
    kind,
    raw,
    body: "",
    variant: "",
    lang: "",
    url: "",
    title: "",
    questionId: "",
    editable: false,
    eol: /\r?\n$/.exec(raw)?.[0] ?? "",
  };
}

/** Reads `{a="b" c="d"}` or `{a=b}` into a map. */
/** Inverse of `attr()` — must round-trip exactly, or the block gets demoted. */
function unattr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#125;/g, "}")
    .replace(/&#123;/g, "{")
    .replace(/&amp;/g, "&");
}

function parseAttrs(attrs: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attrs) return out;
  const inner = attrs.slice(1, -1);
  for (const m of inner.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g)) {
    out[m[1]!] = unattr(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Splits into lines that keep their terminators, so joins are lossless. */
function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split(/(?<=\n)/);
}

/** Strips the trailing newline of a line for content inspection. */
function bare(line: string): string {
  return line.replace(/\r?\n$/, "");
}

// ——— re-serialisers (only used for blocks that proved round-trip safe) ———

/**
 * Escapes a directive attribute value.
 *
 * A raw `"` closes the attribute early and a raw `}` closes the whole directive,
 * so a video title containing either used to corrupt the block — on reload it
 * was no longer recognised as a video at all. Backslash escaping does NOT work
 * in remark-directive; character references do, and they decode back to the
 * original text when the directive is parsed.
 */
function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/\r?\n/g, " ");
}

export function renderBlock(block: Block): string {
  // `eol` reproduces the block's own trailing terminator (see the field docs).
  const end = block.eol === "" ? "" : block.eol;
  switch (block.kind) {
    case "callout":
      return `:::callout{type="${attr(block.variant)}"}\n${block.body}\n:::${end}`;
    case "video":
      // Omit `title` when empty: the importer emitted `{url="…"}` alone for
      // several NLP lessons, and always writing a title would fail their
      // round-trip and demote those blocks to raw text.
      return block.title
        ? `:::video{url="${attr(block.url)}" title="${attr(block.title)}"}\n:::${end}`
        : `:::video{url="${attr(block.url)}"}\n:::${end}`;
    case "practice":
      return `:::practice\n${block.body}\n:::${end}`;
    case "mock":
      return `:::mock{type="${attr(block.variant)}"}\n:::${end}`;
    case "spoiler":
      // Заголовок опускается, когда его нет, — по образцу `video` без title:
      // иначе блок без заголовка не воспроизвёл бы свой raw и деградировал бы
      // в сырой текст.
      return block.title
        ? `:::spoiler{title="${attr(block.title)}"}\n${block.body}\n:::${end}`
        : `:::spoiler\n${block.body}\n:::${end}`;
    case "question":
      return `:::question{id="${attr(block.questionId)}"}\n:::${end}`;
    case "code":
      return `\`\`\`${block.lang}\n${block.body}\n\`\`\`${end}`;
    case "math":
      return `$$\n${block.body}\n$$${end}`;
    case "table":
    case "prose":
      return block.body;
  }
}

/**
 * Splits markdown into blocks. Guarantee: `parse(md).map(b => b.raw).join("")`
 * === md, for any input.
 */
export function parse(markdown: string): Block[] {
  const lines = splitLines(markdown);
  const blocks: Block[] = [];
  let prose: string[] = [];

  const flushProse = () => {
    if (prose.length === 0) return;
    const raw = prose.join("");
    const block = base("prose", raw);
    block.body = raw;
    block.editable = true;
    blocks.push(block);
    prose = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const text = bare(line);

    // Fenced code — opaque: ::: inside must not be treated as a directive.
    const fence = FENCE_RE.exec(text);
    if (fence) {
      const marker = fence[2]!;
      const lang = fence[3]!.trim();
      const collected: string[] = [line];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        collected.push(lines[j]!);
        const inner = bare(lines[j]!);
        if (inner.trimStart().startsWith(marker) && inner.trim() === marker) {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      flushProse();
      const raw = collected.join("");
      const block = base("code", raw);
      block.lang = lang;
      block.body = collected
        .slice(1, closed ? -1 : undefined)
        .join("")
        .replace(/\r?\n$/, "");
      block.editable = closed && renderBlock(block) === raw;
      if (!block.editable) {
        block.kind = "prose";
        block.body = raw;
        block.editable = true;
      }
      blocks.push(block);
      i = j;
      continue;
    }

    // Container directive.
    const open = DIRECTIVE_OPEN_RE.exec(text);
    if (open) {
      const name = open[1]!;
      const attrs = parseAttrs(open[2]);
      const collected: string[] = [line];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        collected.push(lines[j]!);
        if (bare(lines[j]!).trim() === ":::") {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      flushProse();
      const raw = collected.join("");
      const inner = collected
        .slice(1, closed ? -1 : undefined)
        .join("")
        .replace(/\r?\n$/, "");

      const KNOWN: Record<string, BlockKind> = {
        callout: "callout",
        video: "video",
        practice: "practice",
        mock: "mock",
        spoiler: "spoiler",
        question: "question",
      };
      const kind: BlockKind = KNOWN[name] ?? "prose";

      const block = base(kind, raw);
      block.body = inner;
      if (kind === "callout") block.variant = attrs.type ?? "tip";
      if (kind === "mock") block.variant = attrs.type ?? "legend";
      if (kind === "video") {
        block.url = attrs.url ?? "";
        block.title = attrs.title ?? "";
      }
      if (kind === "spoiler") block.title = attrs.title ?? "";
      if (kind === "question") block.questionId = attrs.id ?? "";
      block.editable = closed && kind !== "prose" && renderBlock(block) === raw;
      if (!block.editable) {
        block.kind = "prose";
        block.body = raw;
        block.editable = true;
      }
      blocks.push(block);
      i = j;
      continue;
    }

    // $$ display math.
    if (MATH_OPEN_RE.test(text)) {
      const collected: string[] = [line];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        collected.push(lines[j]!);
        if (MATH_OPEN_RE.test(bare(lines[j]!))) {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      flushProse();
      const raw = collected.join("");
      const block = base("math", raw);
      block.body = collected
        .slice(1, closed ? -1 : undefined)
        .join("")
        .replace(/\r?\n$/, "");
      block.editable = closed && renderBlock(block) === raw;
      if (!block.editable) {
        block.kind = "prose";
        block.body = raw;
        block.editable = true;
      }
      blocks.push(block);
      i = j;
      continue;
    }

    // GFM table: a run of pipe rows.
    if (TABLE_ROW_RE.test(text)) {
      const collected: string[] = [];
      let j = i;
      while (j < lines.length && TABLE_ROW_RE.test(bare(lines[j]!))) {
        collected.push(lines[j]!);
        j += 1;
      }
      // A table needs at least a header + delimiter row to be one.
      if (collected.length >= 2) {
        flushProse();
        const raw = collected.join("");
        const block = base("table", raw);
        block.body = raw;
        block.editable = true;
        blocks.push(block);
        i = j;
        continue;
      }
    }

    prose.push(line);
    i += 1;
  }

  flushProse();
  return blocks;
}

/** Emits raw for untouched blocks and re-renders only what changed. */
export function serialize(blocks: Block[]): string {
  const chunks = blocks.map((b) => (b.dirty ? renderBlock(b) : b.raw));
  // Guard the seam. A block that sat at EOF has `eol: ""`, so appending after it
  // — or moving it up — used to glue the next block's opening fence onto its last
  // line (`:::Абзац.`). Only the join is touched: a chunk that already ends in a
  // newline, and the final chunk, are left exactly as they were, so the
  // byte-fidelity contract still holds for an untouched document.
  return chunks
    .map((chunk, index) =>
      chunk !== "" && index < chunks.length - 1 && !/\n$/.test(chunk) ? `${chunk}\n\n` : chunk,
    )
    .join("");
}

/** Marks a block dirty after an edit, refreshing its raw from the fields. */
export function withEdit(block: Block, patch: Partial<Block>): Block {
  const next: Block = { ...block, ...patch, dirty: true };
  next.raw = renderBlock(next);
  return next;
}

// ——— WHERE BYTE FIDELITY ACTUALLY LIVES ———
//
// There used to be a document-level rail here, `canUseBlockEditor(md)`, which
// returned `parse(md).map(b => b.raw).join("") === md`. An audit showed it was a
// tautology: `parse` GUARANTEES that identity for any input (see the contract on
// `parse` above), so the predicate was always true and gated nothing. It was
// removed rather than redefined — the guarantee it was meant to provide is
// already enforced, more precisely, one block at a time:
//
//   1. PER-BLOCK PROOF. A block is only offered a visual editor when re-rendering
//      its own parsed fields reproduces its source character for character —
//      `renderBlock(block) === block.raw`. A block that fails is demoted to
//      `prose` with `editable: false` and shown as a raw textarea. So a construct
//      the segmentation does not fully understand is never rewritten from fields.
//
//   2. DIRTY FLAG. `serialize` emits `b.raw` verbatim for every block the mentor
//      did not touch, and `renderBlock(b)` only for blocks marked `dirty` by
//      `withEdit`. An untouched document therefore round-trips byte-for-byte no
//      matter what it contains, and an edit can only ever change the bytes of the
//      block that was edited (plus the newline seam, see `serialize`).
//
// Both are pinned by tests in tests/markdown-blocks.test.ts, including a sweep
// over every real lesson and guide in the database.
