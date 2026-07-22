import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// og-image (spec 13.2 block 1): rendered at request time so the brand name
// comes from env (spec 0.5), graphite bg + accent indigo from tokens (5.1).
// Fonts: static Inter woff (latin + cyrillic, OFL) vendored in public/brand/
// fonts — satori cannot consume the app's variable woff2, and public/ is the
// one directory guaranteed present in the standalone Docker image.

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Платформа подготовки к ML-собеседованиям";

const SLOGAN = "Платформа подготовки к ML-собеседованиям";

function font(file: string): Buffer {
  return readFileSync(join(process.cwd(), "public", "brand", "fonts", file));
}

export default function OgImage() {
  const brand = process.env.BRAND_NAME ?? "MENTORS";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          backgroundColor: "#0b0c0e",
          backgroundImage: "radial-gradient(900px 500px at 85% -10%, rgba(94,106,210,0.28), transparent)",
        }}
      >
        <svg width="104" height="104" viewBox="0 0 64 64">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5e6ad2" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="url(#g)" />
          <path
            fill="#ffffff"
            d="M16 46 L16 18 L23.5 18 L32 31 L40.5 18 L48 18 L48 46 L41 46 L41 29.5 L32 43 L23 29.5 L23 46 Z"
          />
        </svg>
        <div
          style={{
            marginTop: 44,
            fontSize: 104,
            fontWeight: 700,
            letterSpacing: -3,
            color: "#edeef0",
          }}
        >
          {brand}
        </div>
        <div style={{ marginTop: 20, fontSize: 38, fontWeight: 400, color: "#9ba0a8" }}>
          {SLOGAN}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", weight: 700, style: "normal", data: font("inter-latin-700-normal.woff") },
        {
          name: "Inter",
          weight: 700,
          style: "normal",
          data: font("inter-cyrillic-700-normal.woff"),
        },
        { name: "Inter", weight: 400, style: "normal", data: font("inter-latin-400-normal.woff") },
        {
          name: "Inter",
          weight: 400,
          style: "normal",
          data: font("inter-cyrillic-400-normal.woff"),
        },
      ],
    },
  );
}
