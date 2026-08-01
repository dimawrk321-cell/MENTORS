"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useReadingProgress, type ReadingProgressState } from "@/lib/hooks/use-reading-progress";

// Reading shell shared by /lessons/[id] and /guides/[slug] («Читалка v2»):
// mounts the single scroll listener, paints the top reading-progress bar and
// publishes the state to the sticky table of contents through context.
//
// `children` is server-rendered content passed through the client boundary — the
// article, the quiz and the key questions stay RSC; only the bar and the TOC are
// interactive.

const ReadingProgressContext = createContext<ReadingProgressState>({
  fraction: 0,
  activeId: null,
});

export function useReadingTracker(): ReadingProgressState {
  return useContext(ReadingProgressContext);
}

/**
 * Top reading-progress bar. Fixed above the sticky zone header (z-30) and clear
 * of the mobile BottomNav (fixed at the BOTTOM, z-40) — it occupies the top 3px
 * of the viewport and never enters the layout, so it cannot shift the reading
 * column or the restored scroll position.
 *
 * scaleX instead of width: a transform never triggers layout, so a fast scroll
 * cannot make the reader's own text reflow. aria-hidden on purpose — the honest,
 * announceable value lives as static «Прочитано N%» text in the table of
 * contents; a live-updating progressbar would flood a screen reader.
 */
function ReadingProgressBar({ fraction }: { fraction: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[3px]">
      <div
        className="h-full origin-left"
        style={{
          transform: `scaleX(${fraction})`,
          backgroundImage: "var(--gradient-accent)",
        }}
      />
    </div>
  );
}

export function ReadingTracker({
  headingIds,
  children,
}: {
  headingIds: string[];
  children: ReactNode;
}) {
  const state = useReadingProgress(headingIds);
  return (
    <ReadingProgressContext.Provider value={state}>
      <ReadingProgressBar fraction={state.fraction} />
      {children}
    </ReadingProgressContext.Provider>
  );
}
