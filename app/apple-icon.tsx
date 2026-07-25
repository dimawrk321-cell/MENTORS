import { ImageResponse } from "next/og";

// Apple-touch / maskable icon (walk 13.4/4.5): full-bleed «P» monogram on the accent
// indigo gradient — iOS masks the corners, so this variant has no rounded rect. Same
// «P» shape + gradient as app/icon.svg and the og-image, rendered via next/og so it
// needs no image-toolchain dependency (sharp is not a direct dep of this repo).

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <svg width="180" height="180" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5e6ad2" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" fill="url(#g)" />
        <path
          fill="#ffffff"
          fillRule="evenodd"
          d="M17 17 L47 17 L47 37 L25 37 L25 47 L17 47 Z M25 24 L40 24 L40 30 L25 30 Z"
        />
      </svg>
    </div>,
    { ...size },
  );
}
