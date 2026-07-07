"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, VideoOff } from "lucide-react";
import { parseYouTubeId, youTubeEmbedUrl, youTubePosterUrl } from "@/lib/utils/youtube";

interface VideoEmbedProps {
  url?: string;
  title?: string;
  /** lessons.video_status — «unavailable» renders the graceful stub (spec 5.3). */
  status?: "ok" | "unavailable" | "unchecked";
  /** Resume position in seconds (spec 7.3: «Продолжить» ведёт на точное место). */
  startAt?: number;
  /** Streams the current playback second (debounced upstream). */
  onProgress?: (seconds: number) => void;
}

/**
 * Spec 5.3 VideoEmbed: 16:9, lazy youtube-nocookie iframe behind a poster,
 * unavailable state without the grey YouTube box. Playback time is read via
 * the documented postMessage listening protocol — best effort, never blocking.
 */
export function VideoEmbed({
  url,
  title,
  status = "unchecked",
  startAt,
  onProgress,
}: VideoEmbedProps) {
  const [playing, setPlaying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoId = url ? parseYouTubeId(url) : null;

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== "https://www.youtube-nocookie.com") return;
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data) as { event?: string; info?: { currentTime?: number } };
        const seconds = data.info?.currentTime;
        if (typeof seconds === "number" && seconds > 0) {
          onProgress?.(Math.floor(seconds));
        }
      } catch {
        // Not a YouTube payload — ignore.
      }
    },
    [onProgress],
  );

  useEffect(() => {
    if (!playing) return;
    window.addEventListener("message", handleMessage);
    // Ask the player to stream infoDelivery events (currentTime included).
    const kick = setInterval(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: "lesson-video" }),
        "https://www.youtube-nocookie.com",
      );
    }, 4000);
    return () => {
      window.removeEventListener("message", handleMessage);
      clearInterval(kick);
    };
  }, [playing, handleMessage]);

  if (status === "unavailable") {
    return (
      <div className="rounded-card border-border bg-surface-1 my-5 flex items-center gap-3 border px-4 py-3.5">
        <VideoOff
          size={18}
          strokeWidth={1.75}
          className="text-text-3 shrink-0"
          aria-hidden="true"
        />
        <p className="text-text-2 text-[14px]">Видео временно недоступно — текст урока полный.</p>
      </div>
    );
  }

  if (!videoId) return null;

  return (
    <figure className="my-5">
      <div className="rounded-card border-border bg-surface-1 relative aspect-video overflow-hidden border">
        {playing ? (
          <iframe
            ref={iframeRef}
            src={youTubeEmbedUrl(videoId, { autoplay: true, startAt })}
            title={title || "Видео урока"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 size-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={title ? `Смотреть: ${title}` : "Смотреть видео"}
            className="group absolute inset-0 size-full"
          >
            <Image
              src={youTubePosterUrl(videoId)}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 680px"
              className="object-cover"
            />
            <span className="ease-app absolute inset-0 bg-black/25 transition-colors duration-150 group-hover:bg-black/35" />
            <span className="rounded-pill ease-app absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-black/65 text-white transition-transform duration-150 group-hover:scale-105">
              <Play size={22} strokeWidth={1.75} className="ml-0.5" aria-hidden="true" />
            </span>
          </button>
        )}
      </div>
      {title ? <figcaption className="text-text-3 mt-2 text-[13px]">{title}</figcaption> : null}
    </figure>
  );
}
