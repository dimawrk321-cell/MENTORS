import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

// youtubeCheck job (spec 7.15): 04:00 daily. Probes the video_url of every
// published lesson and records video_status → feeds the «Видео недоступны» Пульт
// flag and the VideoEmbed `unavailable` заглушка. A probe timeout/network error
// resolves to `unknown` and leaves the lesson untouched (resilience — no false
// negatives from a transient hiccup). Injectable probe keeps the job testable.

export type VideoProbeResult = "ok" | "unavailable" | "unknown";
export type VideoProbe = (url: string) => Promise<VideoProbeResult>;

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Default probe: YouTube oEmbed (200 ⇒ ok, 401/403/404 ⇒ unavailable), HEAD for
 * other hosts. Any timeout/error ⇒ unknown (leave status as-is).
 */
export async function defaultVideoProbe(url: string): Promise<VideoProbeResult> {
  try {
    const isYouTube = /youtu\.?be|youtube(-nocookie)?\.com/i.test(url);
    if (isYouTube) {
      const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await fetch(oembed, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (res.ok) return "ok";
      if ([400, 401, 403, 404].includes(res.status)) return "unavailable";
      return "unknown";
    }
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) return "ok";
    if (res.status === 404 || res.status === 410) return "unavailable";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function runYoutubeCheckJob(
  db: PrismaClient,
  opts: { now?: Date; probe?: VideoProbe } = {},
): Promise<{ checked: number; ok: number; unavailable: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const probe = opts.probe ?? defaultVideoProbe;

  const lessons = await db.lesson.findMany({
    where: { status: "published", videoUrl: { not: null } },
    select: { id: true, videoUrl: true },
  });

  let ok = 0;
  let unavailable = 0;
  let skipped = 0;
  for (const lesson of lessons) {
    let result: VideoProbeResult;
    try {
      result = await probe(lesson.videoUrl!);
    } catch (err) {
      // A misbehaving probe must not crash the sweep.
      logger.warn({ lessonId: lesson.id, err }, "youtubeCheck probe threw — skipping lesson");
      result = "unknown";
    }
    if (result === "unknown") {
      skipped += 1;
      continue; // transient — leave the existing status
    }
    await db.lesson.update({
      where: { id: lesson.id },
      data: { videoStatus: result, videoCheckedAt: now },
    });
    if (result === "ok") ok += 1;
    else unavailable += 1;
  }
  return { checked: lessons.length, ok, unavailable, skipped };
}
