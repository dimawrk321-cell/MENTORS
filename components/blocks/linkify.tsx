import { Fragment, type ReactNode } from "react";

// A4 (spec 13.1): course descriptions are plain text (not the markdown pipeline),
// so bare URLs in imported text render inert. Linkify turns http(s) URLs into
// clickable external links while leaving the rest as text. Trailing sentence
// punctuation is kept out of the href. Safe as a server component.

const URL_RE = /https?:\/\/[^\s<]+/g;
// Punctuation that commonly trails a URL in prose and should not be part of it.
const TRAILING_RE = /[.,;:!?)\]}»"']+$/;

export function Linkify({ text, className }: { text: string; className?: string }): ReactNode {
  if (!text) return null;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(URL_RE)) {
    const full = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(<Fragment key={key++}>{text.slice(last, start)}</Fragment>);
    const trail = TRAILING_RE.exec(full)?.[0] ?? "";
    const href = trail ? full.slice(0, full.length - trail.length) : full;
    out.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className ?? "text-accent break-words hover:underline"}
      >
        {href}
      </a>,
    );
    if (trail) out.push(<Fragment key={key++}>{trail}</Fragment>);
    last = start + full.length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
}
