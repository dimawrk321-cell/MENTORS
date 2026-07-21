import { parseYouTubeId } from "@/lib/utils/youtube";
import { MISSING_IMAGE_PLACEHOLDER, type ImageResolver } from "./images";
import { normalizeImportedMarkdown } from "./normalize";

// Content conversion (spec 7.14 п.4/п.5). Pure string transforms turning a raw
// Notion node body into platform markdown: emoji section headers → clean h3,
// first YouTube → video_url and the rest → :::video, «Практика»/«Материал» →
// directive blocks, 🟠/🚩/⚡ markers stripped, «Проверка себя» → key questions,
// «Категории…» → category links, images rewritten. Every transform degrades
// safely so the render pipeline never crashes on unexpected input.

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const YT_LINK_LINE_RE = /^\s*(?:🔗\s*)?(?:>?\s*)(?:\[[^\]]*\]\(([^)]+)\)|(https?:\/\/\S+))\s*$/;
const CHECK_SELF_RE = /^\s*\*\*Проверк[аи]\s+себя:?\*\*\s*(.*)$/;
const CATEGORY_LINK_RE = /^\s*\*\*Категории вопросов[^*]*:?\*\*\s*(.*)$/;
const HEADING_EMOJI_RE = /^(\s*#{2,6}\s+)(?:[🎬📖🔥📝🧠✅🚀]\s*)+/u;
const LEADING_MARKER_RE = /^(\s*(?:[-*]\s+)?)(?:[🟠🚩⚡🔴🟡🟢🔵]️?\s*)+/u;
const OPTIONAL_TAG_RE = /\s*\(ДОПОЛНИТЕЛЬНО[^)]*\)\s*/iu;

/** Canonical watch URL, or null if not a recognizable YouTube link. */
export function canonicalYouTube(url: string): string | null {
  const id = parseYouTubeId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** Replaces image refs via the resolver; missing files → placeholder + record. */
function rewriteImages(
  markdown: string,
  resolver: ImageResolver,
  todos: Array<{ path: string }>,
): string {
  return markdown.replace(IMAGE_RE, (_whole, alt: string, rawUrl: string) => {
    const resolved = resolver.resolve(rawUrl);
    if (resolved) return `![${alt}](${resolved.url})`;
    todos.push({ path: rawUrl });
    return MISSING_IMAGE_PLACEHOLDER;
  });
}

/** True when a body, image-refs stripped, has no textual content of its own. */
function isImageOnly(markdown: string): boolean {
  const withoutImages = markdown.replace(IMAGE_RE, " ");
  return withoutImages.replace(/\s+/g, "") === "";
}

export interface ConvertedLesson {
  contentMd: string;
  videoUrl: string | null;
  keyQuestions: string[];
  categoryLinkNames: string[];
  todoImages: Array<{ path: string }>;
}

/**
 * Wraps a labeled paragraph and its trailing list/link lines into a directive
 * block. Stops at the next heading, thematic break, blank-separated bold label,
 * or end — a best-effort grouping that always produces valid markdown.
 */
function takeLabeledBlock(lines: string[], start: number): { block: string[]; next: number } {
  const block = [lines[start]!];
  let i = start + 1;
  let blanks = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === "") {
      blanks += 1;
      if (blanks >= 2) break;
      block.push(line);
      continue;
    }
    if (/^\s*#{1,6}\s+/.test(line) || /^\s*\*\*\*\s*$/.test(line) || /^\s*---\s*$/.test(line))
      break;
    // A fresh bold-label paragraph after a blank starts a new block.
    if (blanks >= 1 && /^\s*\*\*[^*]+\*\*/.test(line)) break;
    blanks = 0;
    block.push(line);
  }
  while (block.length > 0 && block[block.length - 1]!.trim() === "") block.pop();
  return { block, next: i };
}

export function convertLessonBody(rawBody: string, resolver: ImageResolver): ConvertedLesson {
  const todoImages: Array<{ path: string }> = [];
  const withImages = rewriteImages(rawBody, resolver, todoImages);

  const keyQuestions: string[] = [];
  const categoryLinkNames: string[] = [];
  let videoUrl: string | null = null;

  // Normalize block indentation first (P3a): the raw export nests bodies deeper
  // than their headings, which would otherwise become indented code blocks.
  const normalized = normalizeImportedMarkdown(withImages);
  const src = normalized.split("\n");
  const out: string[] = [];

  for (let i = 0; i < src.length; i += 1) {
    let line = src[i]!;

    const check = CHECK_SELF_RE.exec(line);
    if (check) {
      const text = check[1]!.trim();
      if (text) keyQuestions.push(text);
      continue;
    }

    const catLink = CATEGORY_LINK_RE.exec(line);
    if (catLink) {
      for (const part of catLink[1]!.split(/[;•]/)) {
        const name = part.trim().replace(/\.$/, "");
        if (name) categoryLinkNames.push(name);
      }
      continue;
    }

    // Standalone YouTube link line: first → video_url (drop), rest → :::video.
    const ytLine = YT_LINK_LINE_RE.exec(line);
    const ytUrl = ytLine ? canonicalYouTube(ytLine[1] ?? ytLine[2] ?? "") : null;
    if (ytUrl) {
      if (!videoUrl) {
        videoUrl = ytUrl;
      } else {
        out.push(`:::video{url="${ytUrl}"}`, ":::");
      }
      continue;
    }

    // «Практика» / «Материал» → directive blocks.
    if (/^\s*\*\*Практика\*\*/.test(line)) {
      const { block, next } = takeLabeledBlock(src, i);
      out.push(":::practice", ...block, ":::");
      i = next - 1;
      continue;
    }
    if (/^\s*\*\*Материал[:*]/.test(line) || /^\s*\*\*Материал\*\*/.test(line)) {
      const { block, next } = takeLabeledBlock(src, i);
      out.push(':::callout{type="material"}', ...block, ":::");
      i = next - 1;
      continue;
    }

    line = line.replace(HEADING_EMOJI_RE, "$1");
    line = line.replace(LEADING_MARKER_RE, "$1");
    out.push(line);
  }

  // If the first video was buried in prose (not a standalone line), still pull
  // the first YouTube URL anywhere as the header video.
  if (!videoUrl) {
    const anyId = [...normalized.matchAll(/https?:\/\/\S+/g)]
      .map((m) => canonicalYouTube(m[0]))
      .find((u): u is string => u !== null);
    videoUrl = anyId ?? null;
  }

  const contentMd = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { contentMd, videoUrl, keyQuestions, categoryLinkNames, todoImages };
}

export interface ConvertedGuide {
  contentMd: string;
  todoImages: Array<{ path: string }>;
}

// A guide video line: an optional media emoji (🎥🎬📹📺▶🔗) prefix, an optional
// blockquote marker, then a markdown link or a bare URL. Guides have no
// video_url field so every YouTube link is inlined as a :::video block.
const GUIDE_VIDEO_LINK_RE =
  /^\s*(?:[🎥🎬📹📺▶🔗]️?\s*)*(?:>?\s*)\[([^\]]*)\]\((https?:\/\/[^)]+)\)\s*$/u;
const GUIDE_VIDEO_BARE_RE = /^\s*(?:[🎥🎬📹📺▶🔗]️?\s*)*(?:>?\s*)(https?:\/\/\S+)\s*$/u;

/**
 * Guide body → platform markdown (importer part 2, spec 7.10/7.14). Same emoji /
 * block conversion rules as lessons, but guides have no video_url field, so ALL
 * YouTube links become inline `:::video` blocks, and «Проверка себя» stays as
 * plain content (guides carry no key questions or category links).
 */
export function convertGuideBody(rawBody: string, resolver: ImageResolver): ConvertedGuide {
  const todoImages: Array<{ path: string }> = [];
  const withImages = rewriteImages(rawBody, resolver, todoImages);

  const src = normalizeImportedMarkdown(withImages).split("\n");
  const out: string[] = [];

  for (let i = 0; i < src.length; i += 1) {
    let line = src[i]!;

    // Every standalone YouTube link → inline :::video (no header video for guides).
    const vLink = GUIDE_VIDEO_LINK_RE.exec(line);
    const vLinkYt = vLink ? canonicalYouTube(vLink[2]!) : null;
    if (vLinkYt) {
      const title = vLink![1]!.replace(/\*\*/g, "").replace(/"/g, "").trim();
      out.push(
        title ? `:::video{url="${vLinkYt}" title="${title}"}` : `:::video{url="${vLinkYt}"}`,
        ":::",
      );
      continue;
    }
    const vBare = GUIDE_VIDEO_BARE_RE.exec(line);
    const vBareYt = vBare ? canonicalYouTube(vBare[1]!) : null;
    if (vBareYt) {
      out.push(`:::video{url="${vBareYt}"}`, ":::");
      continue;
    }

    if (/^\s*\*\*Практика\*\*/.test(line)) {
      const { block, next } = takeLabeledBlock(src, i);
      out.push(":::practice", ...block, ":::");
      i = next - 1;
      continue;
    }
    if (/^\s*\*\*Материал[:*]/.test(line) || /^\s*\*\*Материал\*\*/.test(line)) {
      const { block, next } = takeLabeledBlock(src, i);
      out.push(':::callout{type="material"}', ...block, ":::");
      i = next - 1;
      continue;
    }

    line = line.replace(HEADING_EMOJI_RE, "$1");
    line = line.replace(LEADING_MARKER_RE, "$1");
    out.push(line);
  }

  const contentMd = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { contentMd, todoImages };
}

export interface ConvertedAnswer {
  answerMd: string;
  needsLatex: boolean;
  todoImages: Array<{ path: string }>;
}

/** Question body → answer_md; image-only answers flag needs_latex (spec 7.14). */
export function convertQuestionAnswer(rawBody: string, resolver: ImageResolver): ConvertedAnswer {
  const todoImages: Array<{ path: string }> = [];
  const needsLatex = rawBody.trim() !== "" && isImageOnly(rawBody);
  const answerMd = normalizeImportedMarkdown(rewriteImages(rawBody, resolver, todoImages));
  return { answerMd, needsLatex, todoImages };
}

/** Strips the «(ДОПОЛНИТЕЛЬНО …)» tag from a title, flagging optional lessons. */
export function extractOptional(title: string): { title: string; isOptional: boolean } {
  if (!OPTIONAL_TAG_RE.test(title)) return { title: title.trim(), isOptional: false };
  return {
    title: title.replace(OPTIONAL_TAG_RE, " ").replace(/\s+/g, " ").trim(),
    isOptional: true,
  };
}

/** Leading emoji/marker cleanup for a plain (non-heading) node title. */
export function cleanNodeTitle(title: string): string {
  return title
    .replace(/^(?:[🟠🚩⚡🎬📖🔥📝🧠✅🚀🔴🟡🟢🔵]️?\s*)+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}
