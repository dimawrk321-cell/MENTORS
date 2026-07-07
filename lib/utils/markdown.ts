import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeShiki, { type RehypeShikiOptions } from "@shikijs/rehype";
import { visit } from "unist-util-visit";
import type { Root as MdastRoot } from "mdast";
import type { Element, Root as HastRoot } from "hast";

// Lesson/guide markdown pipeline (spec 7.3): GFM tables, KaTeX ($...$ / $$...$$),
// Shiki code highlighting (SSR, dual theme), and the custom directives
// :::callout{type} / :::video{url title} / :::practice / :::mock{type}.
// Directives compile to custom hast elements that LessonRenderer maps to the
// block components — the single render path for students AND admin preview.

export interface LessonHeading {
  id: string;
  text: string;
  depth: 2 | 3;
}

const DIRECTIVE_ELEMENTS: Record<string, string> = {
  callout: "callout-block",
  video: "video-embed",
  practice: "practice-block",
  mock: "mock-cta",
};

interface DirectiveNode {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
  attributes?: Record<string, string | null | undefined> | null;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  children?: unknown[];
}

/**
 * Maps known directives to custom element names; both container (:::name) and
 * leaf (::name) forms are accepted. Unknown directives degrade to plain
 * containers so foreign markdown never crashes a lesson.
 */
const remarkDirectiveBlocks: Plugin<[], MdastRoot> = () => (tree) => {
  visit(tree, (node) => {
    if (
      node.type !== "containerDirective" &&
      node.type !== "leafDirective" &&
      node.type !== "textDirective"
    ) {
      return;
    }
    const directive = node as unknown as DirectiveNode;
    // Text directives (":name" inline) are not part of the content model —
    // render their children as plain inline content.
    if (directive.type === "textDirective") {
      directive.data = { ...directive.data, hName: "span" };
      return;
    }
    const hName = DIRECTIVE_ELEMENTS[directive.name] ?? "div";
    const attributes = directive.attributes ?? {};
    directive.data = {
      ...directive.data,
      hName,
      hProperties: {
        ...(directive.name === "callout" ? { type: attributes.type ?? "tip" } : {}),
        ...(directive.name === "video"
          ? { url: attributes.url ?? "", title: attributes.title ?? "" }
          : {}),
        ...(directive.name === "mock" ? { type: attributes.type ?? "legend" } : {}),
      },
    };
  });
};

/** Optional line numbers: ```python numbers → data-line-numbers on the <pre>. */
function parseMetaString(meta: string): Record<string, unknown> {
  return /\bnumbers\b/.test(meta) ? { "data-line-numbers": "" } : {};
}

const shikiOptions: RehypeShikiOptions = {
  // Dual theme switched by CSS variables (globals.css keys on html[data-theme]).
  themes: { light: "github-light", dark: "github-dark-default" },
  defaultColor: false,
  fallbackLanguage: "text",
  defaultLanguage: "text",
  // DECISION: language set covers the platform's stack (spec 1: ML/DS/NLP);
  // unknown fences fall back to plain text (built-in, needs no registration).
  langs: ["python", "typescript", "javascript", "sql", "bash", "json", "yaml"],
  parseMetaString,
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective)
  .use(remarkDirectiveBlocks)
  .use(remarkRehype)
  .use(rehypeKatex)
  .use(rehypeSlug)
  .use(rehypeShiki, shikiOptions)
  .freeze();

function extractText(node: { value?: string; children?: unknown[] }): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? [])
    .map((child) => extractText(child as { value?: string; children?: unknown[] }))
    .join("");
}

export interface RenderedLesson {
  hast: HastRoot;
  headings: LessonHeading[];
}

/** Full pipeline run: markdown → hast + collected h2/h3 for the table of contents. */
export async function renderLessonHast(markdown: string): Promise<RenderedLesson> {
  const mdast = processor.parse(markdown);
  const hast = (await processor.run(mdast)) as HastRoot;

  const headings: LessonHeading[] = [];
  visit(hast, "element", (element: Element) => {
    if (element.tagName !== "h2" && element.tagName !== "h3") return;
    const id = typeof element.properties?.id === "string" ? element.properties.id : null;
    if (!id) return;
    headings.push({
      id,
      text: extractText(element as unknown as { children?: unknown[] }),
      depth: element.tagName === "h2" ? 2 : 3,
    });
  });

  return { hast, headings };
}

const WORDS_PER_MINUTE = 180;

/**
 * Spec 6: reading_minutes recomputed on save as words / 180.
 * DECISION: flat whitespace word count over the raw markdown, ceil, min 1 —
 * the spec does not refine tokenization and this stays stable for the badge.
 */
export function computeReadingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
