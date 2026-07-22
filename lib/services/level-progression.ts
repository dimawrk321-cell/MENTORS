import type { Db } from "@/lib/db";
import { getLevelTitles } from "@/lib/services/settings";
import {
  LEVEL_MILESTONES,
  freezeCapForMilestone,
  titleForLevel,
} from "@/lib/services/level-titles";
import { notify } from "@/lib/services/notifications";

// D7 (spec 13.1): the light gamification layer applied on a level-up — milestone
// freeze bonuses (5/10/15/20 → +1, cap 3 from level 10) and the «Новый титул»
// notification. Called by the event dispatcher inside its transaction.

export interface LevelUpResult {
  freezesGranted: number;
  newTitle: string | null;
}

export async function applyLevelUp(
  db: Db,
  input: { userId: string; before: number; after: number; day: Date },
): Promise<LevelUpResult> {
  let freezesGranted = 0;

  // Milestone freeze bonuses. Idempotency barrier: a zero-amount xp_events marker,
  // unique per (user, type, ref) — a replay claims count=0 and skips the grant.
  const crossed = LEVEL_MILESTONES.filter((m) => m > input.before && m <= input.after);
  for (const milestone of crossed) {
    const claim = await db.xpEvent.createMany({
      data: [
        {
          userId: input.userId,
          type: "level.freeze_bonus",
          amount: 0,
          refType: "level",
          refId: String(milestone),
          day: input.day,
        },
      ],
      skipDuplicates: true,
    });
    if (claim.count === 0) continue; // already processed this milestone
    const cap = freezeCapForMilestone(milestone);
    const streak = await db.streak.findUnique({
      where: { userId: input.userId },
      select: { freezes: true },
    });
    const current = streak?.freezes ?? 0;
    if (current < cap) {
      await db.streak.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId, freezes: current + 1 },
        update: { freezes: current + 1 },
      });
      freezesGranted += 1;
    }
  }

  // «Новый титул»: notify only when crossing into a level with a different title.
  const ladder = await getLevelTitles(db);
  const beforeTitle = titleForLevel(input.before, ladder);
  const afterTitle = titleForLevel(input.after, ladder);
  let newTitle: string | null = null;
  if (afterTitle && afterTitle !== beforeTitle) {
    newTitle = afterTitle;
    await notify(db, input.userId, "level_title", { level: input.after, title: afterTitle });
  }

  return { freezesGranted, newTitle };
}
