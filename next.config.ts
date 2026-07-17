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

const LIBRARY_VIEW_CSP = `frame-src 'self' ${YANDEX_DISK_FRAME_SRC}`;

const nextConfig: NextConfig = {
  // Standalone output for the Docker prod image (dev-stand mini-stage / spec 18):
  // produces .next/standalone/server.js with a pruned node_modules trace.
  output: "standalone",
  // Native/node-oriented packages must not be bundled by the RSC compiler.
  serverExternalPackages: ["@node-rs/argon2", "maxmind", "pino", "nodemailer"],
  images: {
    // YouTube poster thumbnails for the lazy VideoEmbed (spec 5.3).
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Spec changelog to section 11: the whole platform is closed from
          // indexing (noindex metadata + this header).
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin" },
        ],
      },
      {
        // Recording viewer only (spec 7.9): allow the Я.Диск iframe.
        source: "/library/:id",
        headers: [{ key: "Content-Security-Policy", value: LIBRARY_VIEW_CSP }],
      },
    ];
  },
};

export default nextConfig;
