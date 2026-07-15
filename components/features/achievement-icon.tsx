import {
  Award,
  BadgeCheck,
  CalendarCheck,
  Flame,
  Footprints,
  GraduationCap,
  Layers,
  Library,
  Medal,
  Moon,
  PackageCheck,
  Rocket,
  ScrollText,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Достижения — монохромные глифы в круге (spec 5.6). Имена приходят из справочника
// ACHIEVEMENTS (lib/services/achievements.ts); неизвестное имя → нейтральный Award.
const ICONS: Record<string, LucideIcon> = {
  Footprints,
  PackageCheck,
  GraduationCap,
  Trophy,
  Target,
  Rocket,
  Layers,
  Library,
  CalendarCheck,
  Swords,
  Medal,
  BadgeCheck,
  ScrollText,
  Flame,
  Moon,
  Zap,
  Sparkles,
};

interface AchievementIconProps {
  name: string;
  size?: number;
  /** true — обесцвеченный глиф (ещё не получено, spec 5.6). */
  muted?: boolean;
  className?: string;
}

export function AchievementIcon({
  name,
  size = 18,
  muted = false,
  className,
}: AchievementIconProps) {
  const Icon = ICONS[name] ?? Award;
  return (
    <span
      className={cn(
        "rounded-pill inline-flex size-8 shrink-0 items-center justify-center border",
        muted
          ? "border-border bg-surface-1 text-text-3"
          : "border-border-strong bg-surface-2 text-text-1",
        className,
      )}
    >
      <Icon size={size} strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}
