import "katex/dist/katex.min.css";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import { renderLessonHast, sanitizeUrl, type LessonHeading } from "@/lib/utils/markdown";
import { Callout } from "@/components/blocks/callout";
import { CodeBlock } from "@/components/blocks/code-block";
import { VideoEmbed } from "@/components/blocks/video-embed";
import { PracticeBlock } from "@/components/blocks/practice-block";
import { MockCta } from "@/components/blocks/mock-cta";
import { MaterialLinkCard } from "@/components/blocks/material-link";
import { Spoiler } from "@/components/blocks/spoiler";
import { InlineQuestionUnavailable } from "@/components/blocks/inline-question-slot";

// The single markdown render path (spec 8.5: admin preview is identical to the
// student view — both call exactly this).

function TableWrap(props: React.ComponentProps<"table">) {
  // Spec 13: no horizontal page overflow — wide tables scroll inside their box.
  return (
    <div className="rounded-card border-border my-5 overflow-x-auto border">
      <table {...props} />
    </div>
  );
}

function SmartLink({ href, children, ...props }: React.ComponentProps<"a">) {
  // 13.2 audit: defense-in-depth href scrub (the pipeline already sanitizes, and
  // React 19 sanitizes javascript: at render — this makes the safety explicit).
  const safeHref = typeof href === "string" ? sanitizeUrl(href, "href") : href;
  const external = typeof safeHref === "string" && /^https?:\/\//.test(safeHref);
  return (
    <a href={safeHref} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} {...props}>
      {children}
    </a>
  );
}

function ImageFrame({ src, alt, ...props }: React.ComponentProps<"img">) {
  // Passe-partout mount (spec 12.1/A3): imported Notion screenshots are white and
  // blind the reader in the dark theme. A white mount with padding + a hairline
  // frame makes any content image look intentional in BOTH themes. <span> wrappers
  // (not <div>) — a lone markdown image is wrapped in a <p>, and a block element
  // inside <p> is invalid DOM and hydration-warns.
  if (typeof src === "string" && (src === "TODO" || src.length === 0)) {
    // Importer placeholder for an image that still needs manual upload (spec 7.14):
    // src="TODO" would otherwise render a broken-image icon inside the frame.
    return (
      <span className="rounded-control border-border text-text-3 my-5 flex items-center justify-center border border-dashed px-4 py-6 text-center text-[13px]">
        {alt || "Изображение будет добавлено"}
      </span>
    );
  }
  return (
    <span className="my-5 flex justify-center">
      <span className="inline-block rounded-[10px] border border-[rgb(0_0_0/0.08)] bg-white p-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt ?? ""} className="block h-auto max-w-full" {...props} />
      </span>
    </span>
  );
}

const baseComponents = {
  "callout-block": Callout,
  "video-embed": VideoEmbed,
  "practice-block": PracticeBlock,
  "material-link": MaterialLinkCard,
  "spoiler-block": Spoiler,
  pre: CodeBlock,
  table: TableWrap,
  a: SmartLink,
  img: ImageFrame,
};

export interface RenderedLessonContent {
  content: ReactNode;
  headings: LessonHeading[];
}

export interface LessonRenderOptions {
  /**
   * Заход B.1: чем рисовать `:::question{id}`. Данные вопросов приходят СНАРУЖИ
   * (страница загружает их одним запросом), поэтому путь рендера остаётся
   * чистым, а предпросмотр студии и страница ученика используют один и тот же
   * компонент — «zero drift» раздела 8.5 сохраняется.
   */
  inlineQuestion?: (questionId: string) => ReactNode;
  /**
   * Заход B.1, блок 3.4: CTA внутри `:::mock` подчиняется правилу «бронь после
   * первого курса». Не задано — CTA как раньше (предпросмотр студии: ученика
   * там нет, гейтить нечего).
   */
  mockLocked?: { nextCourseTitle: string | null } | null;
}

/** Renders markdown to React + returns headings for the table of contents. */
export async function renderLessonContent(
  markdown: string,
  options: LessonRenderOptions = {},
): Promise<RenderedLessonContent> {
  const { hast, headings } = await renderLessonHast(markdown);
  const InlineQuestionSlot = ({ qid }: { qid?: string }) =>
    options.inlineQuestion?.(qid ?? "") ?? <InlineQuestionUnavailable reason="missing" />;
  const MockCtaSlot = (props: { type?: string; children?: ReactNode }) => (
    <MockCta {...props} locked={options.mockLocked ?? null} />
  );
  const components = {
    ...baseComponents,
    "question-embed": InlineQuestionSlot,
    "mock-cta": MockCtaSlot,
  } as unknown as Partial<Components>;
  const content = toJsxRuntime(hast, { Fragment, jsx, jsxs, components });
  return { content, headings };
}

/** Convenience component for places that do not need the TOC (admin preview). */
export async function LessonRenderer({
  markdown,
  options,
}: {
  markdown: string;
  options?: LessonRenderOptions;
}) {
  const { content } = await renderLessonContent(markdown, options);
  return <>{content}</>;
}

// D5 (spec 13.1): a hard render failure in the preview must show a readable
// message with a line number, not the global zone-error page (the (preview) group
// has no error.tsx, so a throw would otherwise escalate to app/error.tsx).
function describeRenderError(error: unknown): { line: number | null; message: string } {
  const e = (error ?? {}) as {
    message?: unknown;
    line?: unknown;
    position?: { start?: { line?: unknown } };
  };
  const line =
    typeof e.line === "number"
      ? e.line
      : typeof e.position?.start?.line === "number"
        ? (e.position.start.line as number)
        : null;
  const message = typeof e.message === "string" ? e.message : String(error);
  if (line === null) {
    // remark/rehype messages often embed «line:column» — pull the line out.
    const m = /(\d+):\d+/.exec(message);
    if (m) return { line: Number(m[1]), message };
  }
  return { line, message };
}

function RenderError({ error }: { error: unknown }) {
  const { line, message } = describeRenderError(error);
  return (
    <div className="rounded-card border-danger/40 bg-danger/10 text-danger border p-4 text-[14px]">
      <p className="font-semibold">
        Ошибка рендера markdown{line !== null ? ` · строка ${line}` : ""}
      </p>
      <p className="mt-1 text-[13px] opacity-80">{message}</p>
      <p className="text-text-3 mt-2 text-[12px]">
        Поправь разметку — предпросмотр обновится после сохранения.
      </p>
    </div>
  );
}

/**
 * Render markdown for a preview without ever blowing up the pane (spec 13.1/D5).
 * Same shape as `renderLessonContent` — the preview ignores the headings today
 * (no table of contents in the studio pane), but the two paths stay symmetric.
 */
export async function renderLessonContentSafe(
  markdown: string,
  options: LessonRenderOptions = {},
): Promise<RenderedLessonContent> {
  try {
    return await renderLessonContent(markdown, options);
  } catch (error) {
    return { content: <RenderError error={error} />, headings: [] };
  }
}
