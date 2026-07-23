import type { MetadataRoute } from "next";

// PWA manifest (spec 13.2 block 1): name from env (spec 0.5 — no hardcoded
// brand), graphite background + accent indigo from the design tokens (5.1).
export default function manifest(): MetadataRoute.Manifest {
  const brand = process.env.BRAND_NAME ?? "PRIME";
  return {
    name: brand,
    short_name: brand,
    description: "Платформа подготовки к ML-собеседованиям",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0c0e",
    theme_color: "#5e6ad2",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/brand/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
