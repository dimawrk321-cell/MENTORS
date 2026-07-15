// Client-safe gamification feedback (spec 5.4/7.7): the shape an action returns
// so a client island can fire the rituals (glow/haptic on level-up, toast on a
// new achievement). No server imports — safe to import from client components.

export interface AchievementBadge {
  key: string;
  title: string;
  /** Имя монохромного глифа Lucide (spec 5.6). */
  icon: string;
}

export interface GamificationFeedback {
  /** XP, начисленный действием. */
  xpAwarded: number;
  /** Новый уровень, если действие подняло уровень (ритуал нового уровня). */
  leveledUpTo: number | null;
  /** Новые достижения — по одному toast на каждое. */
  earnedAchievements: AchievementBadge[];
}

/** Извлекает клиентский фидбек из результата сервиса (события). */
export function toFeedback(source: {
  xpAwarded: number;
  leveledUpTo: number | null;
  earnedAchievements: AchievementBadge[];
}): GamificationFeedback {
  return {
    xpAwarded: source.xpAwarded,
    leveledUpTo: source.leveledUpTo,
    earnedAchievements: source.earnedAchievements.map((a) => ({
      key: a.key,
      title: a.title,
      icon: a.icon,
    })),
  };
}
