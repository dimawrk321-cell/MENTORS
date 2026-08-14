const YANDEX_DISK_VIDEO_RE = /https?:\/\/(?:www\.)?disk\.yandex\.ru\/i\/[^\s)\]}>]+/i;
const YANDEX_DISK_VIDEO_GLOBAL_RE = /https?:\/\/(?:www\.)?disk\.yandex\.ru\/i\/[^\s)\]}>]+/gi;
const ACCESS_SECRET_RE = /(?:парол(?:ь|я|ем)?|password|код\s+доступа)\s*[:=—-]\s*\S+/i;
const ACCESS_SECRET_GLOBAL_RE = /((?:парол(?:ь|я|ем)?|password|код\s+доступа)\s*[:=—-]\s*)\S+/gi;
const RECORDING_CONTEXT_RE =
  /(?:реальн\w*\s+(?:лайфкодинг|собеседован|интервью)|запис[ьи]\s+(?:собеседован|интервью)|как\s+правильно\s+списывать)/i;

export const PROTECTED_RECORDING_NOTICE = `:::callout{type="warning"}
Запись доступна только через [Библиотеку](/library). Там публикуются анонимизированные материалы после проверки согласия; прямые ссылки и пароли в уроках не показываются.
:::`;

/**
 * Interview recordings must go through Library: its 4/4 privacy checklist,
 * per-student access trail and watermark are bypassed by a raw Я.Диск URL.
 * Ordinary Я.Диск lectures remain valid learning sources; the narrow predicate
 * only catches a video link accompanied by a secret or explicit interview/
 * real-livecoding context.
 */
export function hasUnsafeRecordingReference(markdown: string): boolean {
  return (
    YANDEX_DISK_VIDEO_RE.test(markdown) &&
    (ACCESS_SECRET_RE.test(markdown) || RECORDING_CONTEXT_RE.test(markdown))
  );
}

/** Defense-in-depth for already-published legacy content and admin previews. */
export function sanitizeProtectedRecordingMarkdown(markdown: string): string {
  if (!hasUnsafeRecordingReference(markdown)) return markdown;

  const kept = markdown
    .split(/\r?\n/)
    .filter((line) => !YANDEX_DISK_VIDEO_RE.test(line) && !ACCESS_SECRET_RE.test(line))
    .join("\n")
    .trimEnd();

  if (kept.includes(PROTECTED_RECORDING_NOTICE)) return kept;
  return `${kept}${kept ? "\n\n" : ""}${PROTECTED_RECORDING_NOTICE}`;
}

/** Search must never echo a stored direct recording URL or access secret. */
export function redactProtectedRecordingSnippet(value: string): string {
  return value
    .replace(YANDEX_DISK_VIDEO_GLOBAL_RE, "[запись доступна в Библиотеке]")
    .replace(ACCESS_SECRET_GLOBAL_RE, "$1[скрыт]");
}
