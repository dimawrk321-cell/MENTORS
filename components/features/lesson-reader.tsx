"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { LessonPathPolicy, LessonPathSelection } from "@prisma/client";
import { VideoEmbed } from "@/components/blocks/video-embed";
import {
  savePositionAction,
  selectLearningPathAction,
  startLessonAction,
} from "@/lib/actions/content";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

interface LessonReaderProps {
  lessonId: string;
  initialScrollPos: number | null;
  initialVideoPos: number | null;
  completed: boolean;
  /** Read-only impersonation view never writes progress (spec 7.2). */
  impersonated: boolean;
  video: { url: string; status: "ok" | "unavailable" | "unchecked"; title: string } | null;
  pathPolicy: LessonPathPolicy;
  initialSelectedPath: LessonPathSelection | null;
  hasText: boolean;
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
  pathPolicy,
  initialSelectedPath,
  hasText,
  children,
}: LessonReaderProps) {
  const dirty = useRef<{ scroll?: number; video?: number }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedScroll = useRef<number>(initialScrollPos ?? 0);
  const [selectedPath, setSelectedPath] = useState<LessonPathSelection | null>(initialSelectedPath);
  const [selecting, setSelecting] = useState(false);

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
    if (completed || selectedPath === "video" || !initialScrollPos || initialScrollPos <= 0) return;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0) window.scrollTo({ top: initialScrollPos * max });
    });
  }, [completed, initialScrollPos, selectedPath]);

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

  async function choosePath(path: LessonPathSelection): Promise<void> {
    const previous = selectedPath;
    setSelectedPath(path);
    if (impersonated) return;
    setSelecting(true);
    const result = await selectLearningPathAction(lessonId, path);
    setSelecting(false);
    if (!result?.ok) {
      setSelectedPath(previous);
      toast({
        title: result?.error.message ?? "Не удалось сохранить выбранный путь",
        variant: "danger",
      });
    }
  }

  const showChoice = pathPolicy === "choose_one";
  const showVideo =
    Boolean(video) &&
    (pathPolicy === "combined" ||
      pathPolicy === "video_only" ||
      (showChoice && selectedPath === "video"));
  const showText =
    pathPolicy === "combined" ||
    pathPolicy === "text_only" ||
    (pathPolicy === "video_only" && !video) ||
    (showChoice && selectedPath === "text");

  return (
    <>
      {showChoice && (
        <section className="rounded-card border-border bg-surface-1 mb-5 border p-4">
          <h2 className="text-[16px] font-semibold">Как пройти урок?</h2>
          <p className="text-text-2 mt-1 text-[13px]">
            Выбери видео или текст. Контрольные вопросы и завершение урока общие для обоих
            вариантов.
          </p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Путь урока">
            {video && (
              <Button
                variant={selectedPath === "video" ? "primary" : "secondary"}
                loading={selecting && selectedPath === "video"}
                disabled={selecting}
                onClick={() => void choosePath("video")}
              >
                Смотреть видео
              </Button>
            )}
            {hasText && (
              <Button
                variant={selectedPath === "text" ? "primary" : "secondary"}
                loading={selecting && selectedPath === "text"}
                disabled={selecting}
                onClick={() => void choosePath("text")}
              >
                Читать текст
              </Button>
            )}
          </div>
        </section>
      )}
      {showVideo && video && (
        <VideoEmbed
          url={video.url}
          title={video.title}
          status={video.status}
          startAt={initialVideoPos ?? undefined}
          onProgress={onVideoProgress}
          eager
        />
      )}
      {showText && children}
    </>
  );
}
