// YouTube URL → video id (watch, youtu.be, embed, shorts, live forms).

const PATTERNS = [
  /(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
];

export function parseYouTubeId(url: string): string | null {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(url);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function youTubeEmbedUrl(
  id: string,
  opts: { autoplay?: boolean; startAt?: number } = {},
): string {
  const params = new URLSearchParams({ rel: "0", enablejsapi: "1" });
  if (opts.autoplay) params.set("autoplay", "1");
  if (opts.startAt && opts.startAt > 0) params.set("start", String(Math.floor(opts.startAt)));
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

export function youTubePosterUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
