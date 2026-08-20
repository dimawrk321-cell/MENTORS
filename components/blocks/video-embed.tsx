"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Play, VideoOff } from "lucide-react";
import {
  parseYouTubeId,
  videoLinkHost,
  youTubeEmbedUrl,
  youTubePosterUrl,
} from "@/lib/utils/youtube";
import { sanitizeUrl } from "@/lib/utils/safe-url";

interface VideoEmbedProps {
  url?: string;
  title?: string;
  /** lessons.video_status — «unavailable» renders the graceful stub (spec 5.3). */
  status?: "ok" | "unavailable" | "unchecked";
  /** Resume position in seconds (spec 7.3: «Продолжить» ведёт на точное место). */
  startAt?: number;
  /** Streams the current playback second (debounced upstream). */
  onProgress?: (seconds: number) => void;
  /**
   * 13.2 block 6 (perf): the lesson HEADER video sits at the top of the page,
   * so its poster IS the LCP element — preload it (next/image priority) and
   * skip the optimizer proxy (hqdefault is already 480w, ~25KB; CSP img-src
   * allows i.ytimg directly). In-content ::video embeds stay lazy.
   */
  eager?: boolean;
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
  eager = false,
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

  // Заход C.4: ссылка, которую плеер не встраивает (Я.Диск и любой другой
  // источник), больше не исчезает молча. Молчание было худшим из исходов: ментор
  // видел свой блок в редакторе, ученик — пустоту, и никто не получал ни ошибки,
  // ни подсказки. Вместо плеера — карточка со ссылкой и названным источником.
  if (!videoId) return <VideoLinkCard url={url} title={title} />;

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
              priority={eager}
              unoptimized={eager}
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

/**
 * Видео, которое нельзя встроить (заход C.4). Материал у урока есть — он просто
 * живёт на чужом домене, и ученик должен это видеть.
 *
 * Источник называется явно: кнопка без домена не даёт понять, куда уходишь, а
 * уходишь на внешний сайт в новой вкладке. Ссылка чистится тем же
 * `sanitizeUrl`, что и весь markdown-пайплайн (аудит 13.2): `url` приезжает из
 * атрибута директивы, а `rehypeSafeUrls` правит только `href`/`src`, то есть до
 * этого пропа не дотягивается — здесь второй рубеж, а не дубль первого.
 */
function VideoLinkCard({ url, title }: { url?: string; title?: string }) {
  const href = url ? sanitizeUrl(url, "href") : "";
  // Пусто или небезопасная схема — рисовать нечего: кнопка «Открыть видео»,
  // ведущая на «#», врала бы громче, чем прежняя пустота.
  if (!href || href === "#") return null;
  const host = videoLinkHost(href);

  return (
    <figure className="my-5">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-card border-border bg-surface-1 ease-app hover:border-border-strong flex items-center gap-3 border px-4 py-3.5 no-underline transition-colors duration-150"
      >
        <span className="rounded-pill bg-surface-2 text-text-2 flex size-9 shrink-0 items-center justify-center">
          <Play size={16} strokeWidth={1.75} aria-hidden="true" className="ml-0.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-text-1 block text-[14px] font-medium">Открыть видео</span>
          <span className="text-text-3 block truncate text-[12px]">
            {title ? `${title} · ` : ""}
            {host ? `${host} · новая вкладка` : "новая вкладка"}
          </span>
        </span>
        <ExternalLink
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className="text-text-3 shrink-0"
        />
      </a>
    </figure>
  );
}
