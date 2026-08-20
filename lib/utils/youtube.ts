// YouTube URL → video id (watch, youtu.be, embed, shorts, live forms), плюс
// единственный на платформе предикат «плеер справится с этой ссылкой».
//
// Заход C.4: плеер платформы умеет ровно один источник — YouTube. Остальные
// ссылки (Я.Диск и прочее) во фрейм не встают: это запрет НА СТОРОНЕ источника
// (`frame-ancestors` публичной страницы Диска разрешает только домены Вебвизора,
// а `disk.yandex.ru/embed/…` отвечает `X-Frame-Options: SAMEORIGIN` и редиректом
// на паспорт), поэтому послаблением нашей CSP это не лечится. Такая ссылка
// рисуется карточкой «Открыть видео» — см. `components/blocks/video-embed.tsx`.
// Предикат живёт здесь один, чтобы при появлении второго встраиваемого хостинга
// правка была ровно в одном месте: его же читают редактор, путь урока и подписи.

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

/** Появится ли на странице настоящий плеер, а не карточка со ссылкой (заход C.4). */
export function isPlayableVideoUrl(url: string | null | undefined): boolean {
  return Boolean(url && parseYouTubeId(url));
}

/**
 * Домен ссылки для подписи «откроется на …». Показывать ученику источник обязан
 * тот же экран, что даёт ссылку: непонятно, куда ведёт кнопка, — непонятно, можно
 * ли по ней ходить. Ссылка без разбираемого хоста отдаёт пустую строку, и подпись
 * тогда просто не рисуется.
 */
export function videoLinkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
