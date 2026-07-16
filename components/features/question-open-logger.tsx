"use client";

import { useEffect, useRef } from "react";
import { openQuestionAction } from "@/lib/actions/questions";

/**
 * Fires question.opened + the palette recency bump once on mount (spec 7.11 /
 * 7.13). Renders nothing — a side-effect-only island on the question page,
 * mirroring the lesson/guide open pattern. The action is a no-op under
 * impersonation.
 */
export function QuestionOpenLogger({ questionId }: { questionId: string }) {
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    void openQuestionAction(questionId);
  }, [questionId]);
  return null;
}
