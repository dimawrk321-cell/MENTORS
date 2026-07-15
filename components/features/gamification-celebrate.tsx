"use client";

import { toast } from "@/components/ui/toast";
import { AchievementIcon } from "@/components/features/achievement-icon";
import { haptic } from "@/lib/utils/haptic";
import type { GamificationFeedback } from "@/lib/gamification";

// Ритуалы новых уровней и достижений (spec 5.4/5.6/7.7): toast + вибрация.
// Вызывается из клиентских обработчиков после разрешения действия. Кольцо
// дневной цели — отдельный ритуал внутри GoalRing (на дашборде).
export function celebrateGamification(feedback: GamificationFeedback): void {
  if (feedback.leveledUpTo !== null) {
    toast({
      title: `Новый уровень — ${feedback.leveledUpTo}`,
      description: "Так держать",
      variant: "success",
      icon: <AchievementIcon name="Sparkles" />,
    });
    haptic();
  }
  for (const achievement of feedback.earnedAchievements) {
    toast({
      title: "Достижение получено",
      description: achievement.title,
      icon: <AchievementIcon name={achievement.icon} />,
    });
    haptic();
  }
}
