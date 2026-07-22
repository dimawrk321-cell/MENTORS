// Spec 5.7: server-rendered watermark layer over lesson/guide content and the
// library player — diagonal (−30°) email tiling, ~220×140 grid, pointer-events/
// select none, always present in the DOM.
//
// B1 (spec 13.1): light-theme opacity recalibrated .05 → .04 for subjective
// parity with dark. Black marks on the near-white surface read ~22% crisper than
// white marks on the near-black one at equal opacity (0.05×0.98 vs 0.04×1.0, plus
// higher acuity for dark-on-light), so matching dark's .04 lands both at «visible
// on deliberate inspection, invisible while reading».

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
        style={{ backgroundImage: tileSvg(email, "#000000", 0.04), backgroundSize: "220px 140px" }}
      />
    </div>
  );
}
