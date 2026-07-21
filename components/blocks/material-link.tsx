import { ArrowUpRight } from "lucide-react";

// External-material link card (walk 12.3, P3c). Rendered for content links whose
// visible text is the URL itself — a «сходить почитать» reference. Compact: a
// domain chip + shortened path + external-link glyph. Inline-flex so it is valid
// inside a paragraph and wraps; in :::callout{type=material} / :::practice the
// block lays several out as a card grid.

/** «habr.com» + «/ru/articles/1021832» from a URL; degrades to the raw string. */
function splitUrl(url: string): { domain: string; path: string } {
  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, "");
    let path = (u.pathname + u.search).replace(/\/+$/, "");
    if (path === "" || path === "/") path = "";
    // Keep it short: last two meaningful segments are enough to recognise a page.
    const segments = path.split("/").filter(Boolean);
    if (segments.length > 2) path = "…/" + segments.slice(-2).join("/");
    else if (path) path = path.replace(/^\//, "");
    return { domain, path };
  } catch {
    return { domain: url, path: "" };
  }
}

export function MaterialLinkCard({ url }: { url?: string }) {
  if (!url) return null;
  const { domain, path } = splitUrl(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="lesson-material-card rounded-control border-border bg-surface-1 ease-app hover:border-border-strong my-1 inline-flex max-w-full items-center gap-2 border px-3 py-2 text-[13px] no-underline transition-colors duration-150"
    >
      <span className="rounded-pill bg-surface-2 text-text-2 shrink-0 px-2 py-0.5 text-[11px] font-medium">
        {domain}
      </span>
      {path && <span className="text-text-1 min-w-0 truncate">{path}</span>}
      <ArrowUpRight
        size={14}
        strokeWidth={1.75}
        className="text-text-3 shrink-0"
        aria-hidden="true"
      />
    </a>
  );
}
