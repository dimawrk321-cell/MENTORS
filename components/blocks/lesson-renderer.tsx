import "katex/dist/katex.min.css";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import { renderLessonHast, type LessonHeading } from "@/lib/utils/markdown";
import { Callout } from "@/components/blocks/callout";
import { CodeBlock } from "@/components/blocks/code-block";
import { VideoEmbed } from "@/components/blocks/video-embed";
import { PracticeBlock } from "@/components/blocks/practice-block";
import { MockCta } from "@/components/blocks/mock-cta";

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
  const external = typeof href === "string" && /^https?:\/\//.test(href);
  return (
    <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} {...props}>
      {children}
    </a>
  );
}

const components = {
  "callout-block": Callout,
  "video-embed": VideoEmbed,
  "practice-block": PracticeBlock,
  "mock-cta": MockCta,
  pre: CodeBlock,
  table: TableWrap,
  a: SmartLink,
} as unknown as Partial<Components>;

export interface RenderedLessonContent {
  content: ReactNode;
  headings: LessonHeading[];
}

/** Renders markdown to React + returns headings for the table of contents. */
export async function renderLessonContent(markdown: string): Promise<RenderedLessonContent> {
  const { hast, headings } = await renderLessonHast(markdown);
  const content = toJsxRuntime(hast, { Fragment, jsx, jsxs, components });
  return { content, headings };
}

/** Convenience component for places that do not need the TOC (admin preview). */
export async function LessonRenderer({ markdown }: { markdown: string }) {
  const { content } = await renderLessonContent(markdown);
  return <>{content}</>;
}
