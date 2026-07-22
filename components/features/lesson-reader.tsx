"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { VideoEmbed } from "@/components/blocks/video-embed";
import { savePositionAction } from "@/lib/actions/content";
import { startLessonAction } from "@/lib/actions/content";

interface LessonReaderProps {
  lessonId: string;
  initialScrollPos: number | null;
  initialVideoPos: number | null;
  completed: boolean;
  /** Read-only impersonation view never writes progress (spec 7.2). */
  impersonated: boolean;
  video: { url: string; status: "ok" | "unavailable" | "unchecked"; title: string } | null;
  /** Server-rendered lesson body (watermark + prose). */
  children: ReactNode;
}

const SAVE_DEBOUNCE_MS = 2000;

/**
 * Client shell around the lesson body (spec 7.3): fires lesson.started once,
 * restores the reading position, debounce-saves scroll fraction and video
 * seconds. All writes are skipped while impersonating.
 */
export function LessonReader({
  lessonId,
  initialScrollPos,
  initialVideoPos,
  completed,
  impersonated,
  video,
  children,
}: LessonReaderProps) {
  const dirty = useRef<{ scroll?: number; video?: number }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedScroll = useRef<number>(initialScrollPos ?? 0);

  const flush = useCallback(() => {
    timer.current = null;
    const payload = dirty.current;
    dirty.current = {};
    if (payload.scroll === undefined && payload.video === undefined) return;
    void savePositionAction({ lessonId, ...payload });
  }, [lessonId]);

  const scheduleFlush = useCallback(() => {
    if (impersonated) return;
    timer.current ??= setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush, impersonated]);

  // lesson.started — once per user/lesson, service-side idempotent.
  useEffect(() => {
    void startLessonAction(lessonId);
  }, [lessonId]);

  // Restore the reading position («Продолжить» ведёт на точное место).
  // DECISION: completed lessons reopen from the top — resume only mid-progress.
  useEffect(() => {
    if (completed || !initialScrollPos || initialScrollPos <= 0) return;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0) window.scrollTo({ top: initialScrollPos * max });
    });
  }, [completed, initialScrollPos]);

  // Scroll fraction tracking (throttled by the debounce window).
  useEffect(() => {
    if (impersonated) return;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      const fraction = Math.max(0, Math.min(1, window.scrollY / max));
      if (Math.abs(fraction - lastSavedScroll.current) < 0.01) return;
      lastSavedScroll.current = fraction;
      dirty.current.scroll = fraction;
      scheduleFlush();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer.current) {
        clearTimeout(timer.current);
        flush();
      }
    };
  }, [impersonated, scheduleFlush, flush]);

  const onVideoProgress = useCallback(
    (seconds: number) => {
      if (impersonated) return;
      dirty.current.video = seconds;
      scheduleFlush();
    },
    [impersonated, scheduleFlush],
  );

  return (
    <>
      {video && (
        <VideoEmbed
          url={video.url}
          title={video.title}
          status={video.status}
          startAt={initialVideoPos ?? undefined}
          onProgress={onVideoProgress}
          eager
        />
      )}
      {children}
    </>
  );
}
