"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { openGuideAction, toggleBookmarkAction } from "@/lib/actions/guides";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";

/**
 * Bookmark toggle (spec 7.10) that also logs guide.opened once on mount. The
 * toggle is optimistic; a rejected action (e.g. impersonation) rolls it back.
 */
export function GuideBookmark({
  guideId,
  initialBookmarked,
}: {
  guideId: string;
  initialBookmarked: boolean;
}) {
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [pending, startTransition] = useTransition();
  const logged = useRef(false);

  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    void openGuideAction(guideId);
  }, [guideId]);

  function toggle(): void {
    const next = !bookmarked;
    setBookmarked(next);
    startTransition(async () => {
      const res = await toggleBookmarkAction(guideId);
      if (!res) return;
      if (res.ok) setBookmarked(res.data.bookmarked);
      else {
        setBookmarked(!next);
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  }

  const Icon = bookmarked ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? "Убрать из закладок" : "Добавить в закладки"}
      className={cn(
        "rounded-control ease-app flex h-8 shrink-0 items-center gap-1.5 border px-3 text-[13px] transition-colors duration-150",
        bookmarked
          ? "border-accent bg-accent/12 text-accent"
          : "border-border text-text-2 hover:border-border-strong hover:text-text-1",
      )}
    >
      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
      {bookmarked ? "В закладках" : "В закладки"}
    </button>
  );
}
