import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Tinted rounded-square icon tile (design handoff): a 40/44px rounded-12px box with
// a color-mix N% background and a color-matched icon, no border. Replaces the old
// bordered surface-2 circles across the dashboard, courses, trainer, mocks, guides…
export function IconTile({
  icon: Icon,
  colorVar = "var(--accent)",
  size = 40,
  iconSize,
  className,
}: {
  icon: LucideIcon;
  /** CSS colour, e.g. "var(--accent)" | "var(--violet)" | "var(--cat-1)". */
  colorVar?: string;
  size?: 40 | 44;
  iconSize?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[12px]",
        size === 44 ? "size-11" : "size-10",
        className,
      )}
      style={{ background: `color-mix(in srgb, ${colorVar} 12%, transparent)` }}
    >
      <Icon
        size={iconSize ?? (size === 44 ? 22 : 20)}
        strokeWidth={1.75}
        style={{ color: colorVar }}
        aria-hidden="true"
      />
    </span>
  );
}
