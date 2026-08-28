"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, ChevronRight } from "lucide-react";
import type { GuideSectionChapter } from "@/lib/utils/guide-section";
import { toggleBookmarkAction } from "@/lib/actions/guides";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useViewOnly, ViewOnlyNote, VIEW_ONLY_TITLE } from "@/components/features/view-only";

type AccentStyle = CSSProperties & { "--guide-accent": string };

export function GuideSectionChapters({
  chapters,
  focusIndex,
  focusKind,
  accentColor,
}: {
  chapters: GuideSectionChapter[];
  focusIndex: number;
  focusKind: "recent" | "start";
  accentColor: string;
}) {
  const viewOnly = useViewOnly();
  const [bookmarks, setBookmarks] = useState(
    () => new Set(chapters.filter((chapter) => chapter.bookmarked).map((chapter) => chapter.id)),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggleBookmark(guideId: string): void {
    if (viewOnly || pendingId) return;
    const wasBookmarked = bookmarks.has(guideId);
    setBookmarks((current) => {
      const next = new Set(current);
      if (wasBookmarked) next.delete(guideId);
      else next.add(guideId);
      return next;
    });
    setPendingId(guideId);

    startTransition(async () => {
      const result = await toggleBookmarkAction(guideId);
      if (!result?.ok) {
        setBookmarks((current) => {
          const next = new Set(current);
          if (wasBookmarked) next.add(guideId);
          else next.delete(guideId);
          return next;
        });
        if (result) toast({ title: result.error.message, variant: "danger" });
      } else {
        setBookmarks((current) => {
          const next = new Set(current);
          if (result.data.bookmarked) next.add(guideId);
          else next.delete(guideId);
          return next;
        });
      }
      setPendingId(null);
    });
  }

  return (
    <div style={{ "--guide-accent": accentColor } as AccentStyle}>
      <ol className="relative flex flex-col gap-3" aria-label="Главы раздела">
        {chapters.length > 1 && (
          <span
            className="bg-border absolute top-[18px] bottom-[18px] left-[17.5px] w-px"
            aria-hidden="true"
          />
        )}
        {chapters.map((chapter, index) => {
          const current = index === focusIndex;
          const bookmarked = bookmarks.has(chapter.id);
          const BookmarkIcon = bookmarked ? BookmarkCheck : Bookmark;
          const focusLabel =
            focusKind === "recent" ? "Последняя открытая глава" : "Рекомендуем начать здесь";

          return (
            <li
              key={chapter.id}
              className="relative grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3 sm:gap-4"
            >
              <span
                className={cn(
                  "text-text-3 bg-surface-1 relative z-10 flex size-9 items-center justify-center rounded-full border text-[13px] font-semibold tabular-nums",
                  current
                    ? "border-transparent text-white shadow-[0_0_0_5px_color-mix(in_srgb,var(--guide-accent)_12%,transparent)]"
                    : "border-border",
                )}
                style={current ? { backgroundImage: "var(--gradient-accent)" } : undefined}
                aria-hidden="true"
              >
                {index + 1}
              </span>

              <Card
                interactive
                catHover={accentColor}
                data-guide-focus={current ? focusKind : undefined}
                className={cn(
                  "group flex min-h-[72px] min-w-0 items-stretch overflow-hidden",
                  current && "border-[color-mix(in_srgb,var(--guide-accent)_55%,var(--border))]",
                )}
              >
                <Link
                  href={`/guides/${chapter.slug}`}
                  className="flex min-w-0 flex-1 items-center p-3.5 sm:p-4"
                  aria-label={`Открыть главу ${index + 1}: ${chapter.title}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-text-1 group-hover:text-accent text-[14.5px] leading-[1.35] font-semibold tracking-[-0.01em] transition-colors">
                        {chapter.title}
                      </span>
                      {chapter.isNew && (
                        <Badge className="border-violet/40 bg-violet/10 text-violet border">
                          Новый
                        </Badge>
                      )}
                    </span>
                    <span className="text-text-3 mt-1 flex flex-wrap items-center gap-x-2 text-[12px]">
                      <span>{chapter.minutes} мин</span>
                      {current && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span style={{ color: accentColor }}>{focusLabel}</span>
                        </>
                      )}
                    </span>
                  </span>
                </Link>

                <button
                  type="button"
                  onClick={() => toggleBookmark(chapter.id)}
                  disabled={pendingId !== null || viewOnly}
                  title={viewOnly ? VIEW_ONLY_TITLE : undefined}
                  aria-pressed={bookmarked}
                  aria-label={
                    bookmarked
                      ? `Убрать из закладок: ${chapter.title}`
                      : `В закладки: ${chapter.title}`
                  }
                  className={cn(
                    "m-2 flex size-11 shrink-0 items-center justify-center rounded-[9px] transition-colors disabled:opacity-50 md:size-9",
                    bookmarked
                      ? "bg-accent/12 text-accent"
                      : "text-text-3 hover:bg-surface-2 hover:text-text-1",
                  )}
                >
                  <BookmarkIcon
                    size={17}
                    strokeWidth={1.75}
                    fill={bookmarked ? "currentColor" : "none"}
                    aria-hidden="true"
                  />
                </button>
                <Link
                  href={`/guides/${chapter.slug}`}
                  aria-label={`Читать «${chapter.title}»`}
                  className="text-text-3 hover:text-text-1 mr-1 hidden size-11 shrink-0 items-center justify-center sm:flex md:size-9"
                >
                  <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
                </Link>
              </Card>
            </li>
          );
        })}
      </ol>
      {viewOnly && (
        <ViewOnlyNote className="mt-3">Режим просмотра: закладки не меняются.</ViewOnlyNote>
      )}
    </div>
  );
}
