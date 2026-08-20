/**
 * URL-scheme allowlist (13.2 audit). Markdown link syntax `[t](javascript:…)`
 * compiles to `<a href="javascript:…">`; the JSX render path is covered by
 * React 19's built-in sanitizeURL, but renderMarkdownHtml → dangerouslySetInnerHTML
 * (question-editor preview) is NOT — a mentor-authored javascript: link would land
 * live in an owner's DOM. This normalizes href/src to safe schemes in BOTH
 * pipelines (defense-in-depth). Control chars/whitespace that obfuscate a scheme
 * are stripped before the test; an unsafe URL becomes "#".
 *
 * Заход C.4: функция вынесена из `lib/utils/markdown.ts` в отдельный модуль без
 * зависимостей. `VideoEmbed` — клиентский компонент, и ему тоже нужно чистить
 * ссылку перед `<a href>`; импорт из `markdown.ts` утащил бы в браузерный бандл
 * весь пайплайн unified/remark/shiki. Реализация одна, второй копии нет.
 */
export function sanitizeUrl(value: unknown, kind: "href" | "src"): string {
  if (typeof value !== "string") return "";
  const probe = value.replace(/[\u0000-\u0020\u007F-\u009F]/g, "").toLowerCase();
  // Relative, anchor, protocol-relative-safe, or an explicit safe scheme.
  if (/^(https?:|mailto:|tel:|\/|#|\.|\?)/.test(probe)) return value;
  // Inline data images are the only data: allowed, and only for src (KaTeX etc.).
  if (kind === "src" && /^data:image\//.test(probe)) return value;
  if (!/^[a-z][a-z0-9+.-]*:/.test(probe)) return value; // scheme-less → treat as relative
  return kind === "href" ? "#" : "";
}
