"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/toast";

// Block 2v2.3: a locked course is VISIBLE in the catalog but not navigable.
// Two entry points to the same message:
//   • clicking the card    → soft stub (this file, LockedCourseCard);
//   • a direct /courses/x  → server redirect back here with ?locked= (LockedNotice).

function lockedMessage(unlocksAfter: string | null): { title: string; description: string } {
  return {
    title: "Курс пока закрыт",
    description: unlocksAfter
      ? `Откроется после курса «${unlocksAfter}».`
      : "Открой предыдущий курс, чтобы продолжить путь.",
  };
}

/**
 * Wraps a locked course card: same visuals as the open one, but a button that
 * explains instead of a link that navigates. Keeps the card markup in the RSC.
 */
export function LockedCourseCard({
  title,
  unlocksAfter,
  children,
}: {
  title: string;
  unlocksAfter: string | null;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => toast(lockedMessage(unlocksAfter))}
      aria-label={
        unlocksAfter ? `${title} — откроется после курса «${unlocksAfter}»` : `${title} — закрыт`
      }
      className="group focus-visible:ring-accent/50 block w-full min-w-0 cursor-pointer rounded-[12px] text-left focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

/**
 * Fires the same message after a direct-URL redirect. `?locked=<title>` carries
 * only the course title — the wording lives here, not in the query string.
 */
export function LockedNotice() {
  const params = useSearchParams();
  const locked = params.get("locked");
  const shown = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!locked || shown.current === locked) return;
    shown.current = locked;
    toast({
      title: "Курс пока закрыт",
      description: `«${locked}» откроется, когда пройдёшь предыдущий курс.`,
    });
    // Strip the param so a reload (or a back-navigation) does not repeat it.
    const url = new URL(window.location.href);
    url.searchParams.delete("locked");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [locked]);

  return null;
}
