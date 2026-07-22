import type { NextConfig } from "next";

// Spec 7.9 / 11: the recording viewer embeds a Я.Диск iframe, so /library/[id]
// (and only that page) must allow the disk.yandex.* range as a frame source.
// Host-source syntax can't wildcard a TLD, so the disk domains are enumerated;
// *.yandex.net covers the CDN the embedded player streams from. Only frame-src
// is set (no default-src) — a minimal, page-scoped relaxation, not a site CSP.
const YANDEX_DISK_FRAME_SRC = [
  "https://disk.yandex.ru",
  "https://disk.yandex.com",
  "https://disk.yandex.net",
  "https://disk.yandex.kz",
  "https://disk.yandex.by",
  "https://disk.yandex.uz",
  "https://disk.360.yandex.ru",
  "https://disk.360.yandex.net",
  "https://*.yandex.net",
].join(" ");

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
// - frame-src youtube-nocookie: lesson video embeds (spec 5.3). The recording
//   viewer additionally needs the Я.Диск range — appended point-wise on
//   /library/:id only (spec 7.9), the rest of the site keeps the tight list.
const isDev = process.env.NODE_ENV === "development";

function csp(frameExtra = ""): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://i.ytimg.com",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    `frame-src 'self' https://www.youtube-nocookie.com${frameExtra ? ` ${frameExtra}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Modern twin of X-Frame-Options: DENY (kept below for older agents).
    "frame-ancestors 'none'",
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
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // Everything except /library/<id> — tight frame-src. Multiple CSP
        // headers on one response INTERSECT, so the two rules must not overlap:
        // path-to-regexp negative lookahead keeps /library/* out of this rule
        // (/library itself — no slash after — still matches and gets the tight CSP).
        source: "/((?!library/).*)",
        headers: [{ key: "Content-Security-Policy", value: csp() }],
      },
      {
        // Recording viewer only (spec 7.9): the same CSP with the Я.Диск range
        // appended to frame-src for the embedded player.
        source: "/library/:id*",
        headers: [{ key: "Content-Security-Policy", value: csp(YANDEX_DISK_FRAME_SRC) }],
      },
    ];
  },
};

export default nextConfig;
