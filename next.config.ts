import type { NextConfig } from "next";

// Заход C.5: перечисление доменов disk.yandex.* в frame-src снято вместе с
// веткой встраивания записей. Оно открывало НАШУ сторону там, где закрыта
// сторона Диска: публичная страница записи отдаёт
// `frame-ancestors webvisor.com *.webvisor.com …`, а `/embed/<ключ>` — 302 на
// паспорт и `X-Frame-Options: SAMEORIGIN`. Потребителя у послабления не было ни
// одного (замер перед миграцией: 1 запись, 0 с embed_url), поэтому CSP снова
// одна на весь сайт, а /library/:id больше не нуждается в отдельном правиле.
//
// Site-wide CSP (spec 13.2 block 2). Notes on the relaxations:
// - script-src 'unsafe-inline': Next App Router injects inline bootstrap/RSC
//   scripts and the anti-FOUC theme script (app/layout.tsx) — nonce plumbing
//   would require dynamic rendering of every page; accepted for the closed
//   platform. Dev additionally needs 'unsafe-eval' (react-refresh) and ws:
//   (HMR websocket) — appended only when NODE_ENV=development.
// - style-src 'unsafe-inline': Tailwind v4 runtime <style>, KaTeX and Shiki
//   inline style attributes.
// - img-src data: blob:: KaTeX data-URIs, upload previews; i.ytimg.com is the
//   YouTube poster CDN (also used via next/image).
// - frame-src youtube-nocookie: lesson video embeds (spec 5.3) — единственный
//   сторонний источник во фрейме на всей платформе (заход C.5).
const isDev = process.env.NODE_ENV === "development";

function csp(frameAncestors = "'none'"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://i.ytimg.com",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "frame-src 'self' https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Modern twin of X-Frame-Options: DENY (kept below for older agents).
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}

const SECURITY_HEADERS = [
  // Spec changelog to section 11: the whole platform is closed from
  // indexing (noindex metadata + this header).
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Only meaningful over TLS (browsers ignore it on http:// responses, so it is
  // safe to send unconditionally — including local dev).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // No sensor/media APIs anywhere; fullscreen keeps its default ('self' +
  // delegation via the video iframe allow attribute).
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Standalone output for the Docker prod image (dev-stand mini-stage / spec 18):
  // produces .next/standalone/server.js with a pruned node_modules trace.
  output: "standalone",
  // Native/node-oriented packages must not be bundled by the RSC compiler.
  serverExternalPackages: ["@node-rs/argon2", "maxmind", "pino", "nodemailer"],
  // NOTE (spec 7.14 / security): the large export upload does NOT go through a
  // Server Action — raising serverActions.bodySizeLimit is global and would let
  // every action accept 100+ MB bodies (a DoS amplifier). The upload is a Route
  // Handler (POST /api/admin/import) that checks admin RBAC + Content-Length
  // BEFORE buffering, so the default 1 MB action limit stays untouched.
  images: {
    // YouTube poster thumbnails for the lazy VideoEmbed (spec 5.3).
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
  },
  async headers() {
    return [
      {
        // Одно правило на весь сайт (заход C.5). До этого CSP жила отдельной
        // строкой с негативным lookahead `/((?!library/).*)`, а рядом стояло
        // правило под `/library/:id` с доменами Я.Диска во `frame-src`:
        // два CSP-заголовка на одном ответе ПЕРЕСЕКАЮТСЯ, поэтому правила не
        // имели права перекрываться. Послабление снято — исключение стало не
        // нужно, и CSP переезжает к остальным заголовкам безопасности, вместо
        // второй записи с тем же самым `source`.
        source: "/:path*",
        headers: [...SECURITY_HEADERS, { key: "Content-Security-Policy", value: csp() }],
      },
      {
        // Editor live preview (spec 8.5 / changelog 13.6): the lesson and guide
        // editors frame /content-preview/:id and /guide-preview/:id — same
        // origin. But `X-Frame-Options: DENY` + `frame-ancestors 'none'` forbid
        // framing by ANY ancestor, the app itself included — there is no
        // same-origin exception — so the iframe was blocked
        // (ERR_BLOCKED_BY_RESPONSE → «сайт не позволяет установить соединение»).
        // These two routes, and only these, relax to 'self'; they are gated by
        // content.manage, so an outsider cannot open them, and cross-origin
        // clickjacking stays impossible.
        // Order is load-bearing: headers() lets the LAST matching rule replace a
        // same-key header, so this is a point-wise override of the two rules above.
        // Заход C.5: упрощение правила выше на это НЕ влияет — переопределение
        // держится на порядке, а не на том, каким паттерном записан общий случай
        // (проверено фактическими заголовками ответа, см. запись захода).
        source: "/(content-preview|guide-preview)/:id*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: csp("'self'") },
        ],
      },
    ];
  },
};

export default nextConfig;
