// Small progress ring (design handoff): a 44px SVG donut in a category colour with
// the percent in the centre — used on the dashboard course mini-cards (ring variant).
export function ProgressRing({
  pct,
  colorVar,
  size = 44,
  stroke = 5,
  label,
}: {
  pct: number;
  /** CSS colour for the fill arc, e.g. "var(--cat-0)". */
  colorVar: string;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (c * clamped) / 100;
  const center = size / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle
          cx={center}
          cy={center}
          r={r}
          stroke="var(--border)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={center}
          cy={center}
          r={r}
          stroke={colorVar}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">
        {clamped}%
      </span>
    </div>
  );
}
