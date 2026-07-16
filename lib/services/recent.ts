import type { RecentItemType } from "@prisma/client";
import type { Db } from "@/lib/db";
import { RECENT_KEEP, RECENT_SHOW, recordingCardTitle } from "@/lib/constants";
import { stripMarkdown } from "@/lib/utils/text";

// Recency index for the CommandPalette «Недавнее» first screen (spec 7.11).
//
// DECISION (spec 7.11): stored in a dedicated `recent_items` table, NOT derived
// from analytics_events. Two reasons: (1) re-opens must resurface, but the open
// events in analytics are one-shot (lesson.started fires once) — an upsert here
// bumps openedAt every time; (2) a tiny, always-current, single-indexed table
// keeps the first-screen query well inside the <100ms palette budget, versus
// scanning + de-duping the append-only event log. The last RECENT_KEEP per user
// are kept (older pruned on write).

export interface RecentEntry {
  type: RecentItemType;
  id: string;
  title: string;
  url: string;
}

/**
 * Record an open (spec 7.11). Upserts (user, type, entity) → openedAt=now so a
 * re-open moves the row to the top, then prunes to the last RECENT_KEEP. Callers
 * skip this under impersonation (read-only, spec 7.2).
 */
export async function touchRecentItem(
  db: Db,
  input: { userId: string; itemType: RecentItemType; entityId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.recentItem.upsert({
    where: {
      userId_itemType_entityId: {
        userId: input.userId,
        itemType: input.itemType,
        entityId: input.entityId,
      },
    },
    create: {
      userId: input.userId,
      itemType: input.itemType,
      entityId: input.entityId,
      openedAt: now,
    },
    update: { openedAt: now },
  });
  // Prune: drop rows older than the RECENT_KEEP-th newest for this user.
  const boundary = await db.recentItem.findMany({
    where: { userId: input.userId },
    orderBy: { openedAt: "desc" },
    skip: RECENT_KEEP,
    take: 1,
    select: { openedAt: true },
  });
  if (boundary[0]) {
    // boundary is the (RECENT_KEEP+1)-th newest row; delete it and everything
    // older (<=), leaving exactly RECENT_KEEP.
    await db.recentItem.deleteMany({
      where: { userId: input.userId, openedAt: { lte: boundary[0].openedAt } },
    });
  }
}

/**
 * Resolve the last RECENT_SHOW opened entities to live, still-visible targets
 * (spec 7.11). Filters out entities that became unpublished/deleted; recordings
 * are dropped entirely when the user's library is disabled (spec 7.9).
 */
export async function getRecentItems(
  db: Db,
  input: { userId: string; libraryEnabled: boolean },
): Promise<RecentEntry[]> {
  // Over-fetch: some rows may resolve to hidden/deleted entities and drop out.
  const rows = await db.recentItem.findMany({
    where: { userId: input.userId },
    orderBy: { openedAt: "desc" },
    take: RECENT_KEEP,
    select: { itemType: true, entityId: true },
  });
  if (rows.length === 0) return [];

  const idsByType = (t: RecentItemType) =>
    rows.filter((r) => r.itemType === t).map((r) => r.entityId);

  const [lessons, questions, guides, recordings] = await Promise.all([
    db.lesson.findMany({
      where: { id: { in: idsByType("lesson") }, status: "published" },
      select: { id: true, title: true },
    }),
    db.question.findMany({
      where: { id: { in: idsByType("question") }, status: "published" },
      select: { id: true, textMd: true },
    }),
    db.guide.findMany({
      where: { id: { in: idsByType("guide") }, status: "published" },
      select: { id: true, slug: true, title: true },
    }),
    input.libraryEnabled
      ? db.recording.findMany({
          where: { id: { in: idsByType("recording") }, status: "published" },
          select: { id: true, stage: true, direction: true, grade: true },
        })
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, RecentEntry>();
  for (const l of lessons)
    byId.set(`lesson:${l.id}`, {
      type: "lesson",
      id: l.id,
      title: l.title,
      url: `/lessons/${l.id}`,
    });
  for (const q of questions)
    byId.set(`question:${q.id}`, {
      type: "question",
      id: q.id,
      title: stripMarkdown(q.textMd, 80),
      url: `/questions/${q.id}`,
    });
  for (const g of guides)
    byId.set(`guide:${g.id}`, {
      type: "guide",
      id: g.id,
      title: g.title,
      url: `/guides/${g.slug}`,
    });
  for (const r of recordings)
    byId.set(`recording:${r.id}`, {
      type: "recording",
      id: r.id,
      title: recordingCardTitle(r),
      url: `/library/${r.id}`,
    });

  // Reconstruct in recency order and cap at RECENT_SHOW.
  const out: RecentEntry[] = [];
  for (const row of rows) {
    const entry = byId.get(`${row.itemType}:${row.entityId}`);
    if (entry) out.push(entry);
    if (out.length >= RECENT_SHOW) break;
  }
  return out;
}
