import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/node-oriented packages must not be bundled by the RSC compiler.
  serverExternalPackages: ["@node-rs/argon2", "maxmind", "pino"],
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
    ];
  },
};

export default nextConfig;
