// Spec 5.7: server-rendered watermark layer over lesson/guide content and the
// library player — diagonal (−30°) email tiling, ~220×140 grid, opacity .04
// (dark) / .05 (light), pointer-events/select none, always present in the DOM.

function tileSvg(email: string, fill: string, opacity: number): string {
  const safe = email.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="140">` +
    `<text x="110" y="70" text-anchor="middle" transform="rotate(-30 110 70)" ` +
    `font-family="Inter, sans-serif" font-size="13" fill="${fill}" fill-opacity="${opacity}">${safe}</text>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function Watermark({ email }: { email: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* Two tint layers; the active theme shows exactly one (globals.css). */}
      <div
        className="wm-dark absolute inset-0 bg-repeat"
        style={{ backgroundImage: tileSvg(email, "#ffffff", 0.04), backgroundSize: "220px 140px" }}
      />
      <div
        className="wm-light absolute inset-0 bg-repeat"
        style={{ backgroundImage: tileSvg(email, "#000000", 0.05), backgroundSize: "220px 140px" }}
      />
    </div>
  );
}
