// Brand mark (design handoff): gradient-accent tile with the brand initial + an
// optional PRIME/label text stack. Shared by the admin desktop sidebar and the
// admin mobile header so the logo is one implementation.
export function BrandMark({
  brandName,
  sublabel,
  tileSize = 22,
  showLabel = true,
}: {
  brandName: string;
  sublabel?: string;
  tileSize?: number;
  showLabel?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="flex shrink-0 items-center justify-center font-bold text-white"
        style={{
          width: tileSize,
          height: tileSize,
          borderRadius: Math.round(tileSize * 0.29),
          fontSize: Math.round(tileSize * 0.54),
          backgroundImage: "var(--gradient-accent)",
        }}
        aria-hidden="true"
      >
        {brandName.trim().charAt(0).toUpperCase()}
      </span>
      {showLabel && (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold tracking-tight">{brandName}</div>
          {sublabel && <div className="text-text-3 text-[11px]">{sublabel}</div>}
        </div>
      )}
    </div>
  );
}
