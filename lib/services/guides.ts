import type { ContentStatus, GuideSection, PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import { emitEvent } from "@/lib/services/events";
import { writeAudit } from "@/lib/services/audit";
import { computeReadingMinutes } from "@/lib/utils/markdown";
import { slugify } from "@/lib/utils/slug";

// Guides service (spec 7.10): the reference section. No progression, no ticks —
// just published markdown grouped by section, with per-user bookmarks and a
// title substring search (FTS lands at stage 8).

export interface GuideNavItem {
  id: string;
  slug: string;
  section: GuideSection;
  title: string;
}

// --- Student reading ---

/** All published guides, ordered for the section sidebar (spec 7.10). */
export async function listPublishedGuides(db: Db): Promise<GuideNavItem[]> {
  return db.guide.findMany({
    where: { status: "published" },
    orderBy: [{ section: "asc" }, { order: "asc" }, { title: "asc" }],
    select: { id: true, slug: true, section: true, title: true },
  });
}

export async function getGuideBySlug(db: Db, slug: string) {
  return db.guide.findFirst({
    where: { slug, status: "published" },
    select: { id: true, slug: true, section: true, title: true, contentMd: true },
  });
}

/** Substring search over published guide titles (spec 7.10: FTS — этап 8). */
export async function searchGuidesByTitle(db: Db, q: string): Promise<GuideNavItem[]> {
  const query = q.trim();
  if (!query) return [];
  return db.guide.findMany({
    where: { status: "published", title: { contains: query, mode: "insensitive" } },
    orderBy: [{ section: "asc" }, { order: "asc" }],
    select: { id: true, slug: true, section: true, title: true },
    take: 50,
  });
}

// --- Bookmarks (spec 7.10) ---

export async function listBookmarkedGuides(db: Db, userId: string): Promise<GuideNavItem[]> {
  const rows = await db.bookmark.findMany({
    where: { userId, guide: { status: "published" } },
    orderBy: { createdAt: "desc" },
    select: { guide: { select: { id: true, slug: true, section: true, title: true } } },
  });
  return rows.map((row) => row.guide);
}

export async function isGuideBookmarked(db: Db, userId: string, guideId: string): Promise<boolean> {
  const row = await db.bookmark.findUnique({
    where: { userId_guideId: { userId, guideId } },
    select: { id: true },
  });
  return row !== null;
}

export type ToggleBookmarkResult =
  { ok: true; bookmarked: boolean } | { ok: false; code: "not_found" };

/**
 * Toggle a bookmark (spec 7.10). The (user, guide) pair is unique; the returned
 * `bookmarked` flag reflects the new state. Emits bookmark.toggled.
 */
export async function toggleBookmark(
  db: PrismaClient,
  input: { userId: string; guideId: string; now?: Date },
): Promise<ToggleBookmarkResult> {
  const guide = await db.guide.findFirst({
    where: { id: input.guideId, status: "published" },
    select: { id: true },
  });
  if (!guide) return { ok: false, code: "not_found" };

  const existing = await db.bookmark.findUnique({
    where: { userId_guideId: { userId: input.userId, guideId: input.guideId } },
    select: { id: true },
  });

  let bookmarked = false;
  await db.$transaction(async (tx) => {
    if (existing) {
      await tx.bookmark.delete({ where: { id: existing.id } });
      bookmarked = false;
    } else {
      await tx.bookmark.create({ data: { userId: input.userId, guideId: input.guideId } });
      bookmarked = true;
    }
    await emitEvent(
      tx,
      "bookmark.toggled",
      { guideId: input.guideId, bookmarked },
      { userId: input.userId, now: input.now },
    );
  });
  return { ok: true, bookmarked };
}

/** Logs a guide open (spec 7.13: guide.opened). Analytics only, no dedup. */
export async function logGuideOpen(
  db: PrismaClient,
  input: { userId: string; guideId: string; now?: Date },
): Promise<void> {
  await emitEvent(
    db,
    "guide.opened",
    { guideId: input.guideId },
    {
      userId: input.userId,
      now: input.now,
    },
  );
}

// --- Admin CRUD (spec 8.5: контент-студия, вкладка «Справочник») ---

export async function listGuidesAdmin(db: Db) {
  return db.guide.findMany({
    orderBy: [{ section: "asc" }, { order: "asc" }, { title: "asc" }],
    select: {
      id: true,
      slug: true,
      section: true,
      title: true,
      order: true,
      status: true,
      updatedAt: true,
    },
  });
}

export async function getGuideForEditor(db: Db, id: string) {
  return db.guide.findUnique({ where: { id } });
}

/** Next order value within a section (append to the end). */
async function nextGuideOrder(db: Db, section: GuideSection): Promise<number> {
  const last = await db.guide.findFirst({
    where: { section },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  return (last?.order ?? -1) + 1;
}

/** Globally-unique slug derived from a title, disambiguated with a counter. */
async function uniqueGuideSlug(db: Db, base: string): Promise<string> {
  const root = slugify(base) || "guide";
  let candidate = root;
  for (let i = 2; ; i += 1) {
    const clash = await db.guide.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash) return candidate;
    candidate = `${root}-${i}`;
  }
}

export async function createGuide(
  db: PrismaClient,
  input: { actorId: string; section: GuideSection; title: string },
): Promise<{ id: string }> {
  const slug = await uniqueGuideSlug(db, input.title);
  const order = await nextGuideOrder(db, input.section);
  const created = await db.$transaction(async (tx) => {
    const row = await tx.guide.create({
      data: {
        slug,
        section: input.section,
        title: input.title,
        order,
        contentMd: "",
        status: "draft",
      },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "guide.created",
      entityType: "guide",
      entityId: row.id,
      after: { title: input.title, section: input.section, slug },
    });
    return row;
  });
  return { id: created.id };
}

export type GuideMutationResult =
  { ok: true } | { ok: false; code: "not_found" | "slug_taken" | "not_draft" };

/** Content autosave (no audit — mirrors lesson autosave, spec changelog 7.13). */
export async function saveGuideContent(
  db: Db,
  input: { guideId: string; contentMd: string },
): Promise<GuideMutationResult & { readingMinutes?: number }> {
  const guide = await db.guide.findUnique({
    where: { id: input.guideId },
    select: { id: true },
  });
  if (!guide) return { ok: false, code: "not_found" };
  await db.guide.update({
    where: { id: input.guideId },
    data: { contentMd: input.contentMd },
  });
  return { ok: true, readingMinutes: computeReadingMinutes(input.contentMd) };
}

export async function updateGuideMeta(
  db: PrismaClient,
  input: {
    actorId: string;
    guideId: string;
    title: string;
    slug: string;
    section: GuideSection;
    order: number;
  },
): Promise<GuideMutationResult> {
  const before = await db.guide.findUnique({ where: { id: input.guideId } });
  if (!before) return { ok: false, code: "not_found" };

  const clash = await db.guide.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (clash && clash.id !== input.guideId) return { ok: false, code: "slug_taken" };

  await db.$transaction(async (tx) => {
    await tx.guide.update({
      where: { id: input.guideId },
      data: {
        title: input.title,
        slug: input.slug,
        section: input.section,
        order: input.order,
      },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "guide.updated",
      entityType: "guide",
      entityId: input.guideId,
      before: {
        title: before.title,
        slug: before.slug,
        section: before.section,
        order: before.order,
      },
      after: { title: input.title, slug: input.slug, section: input.section, order: input.order },
    });
  });
  return { ok: true };
}

export async function setGuideStatus(
  db: PrismaClient,
  input: { actorId: string; guideId: string; status: ContentStatus },
): Promise<GuideMutationResult> {
  const before = await db.guide.findUnique({ where: { id: input.guideId } });
  if (!before) return { ok: false, code: "not_found" };
  await db.$transaction(async (tx) => {
    await tx.guide.update({
      where: { id: input.guideId },
      data: { status: input.status },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "guide.status_changed",
      entityType: "guide",
      entityId: input.guideId,
      before: { status: before.status },
      after: { status: input.status },
    });
  });
  return { ok: true };
}

/** Delete — drafts only (spec changelog 8.5: published content is never deleted). */
export async function deleteGuide(
  db: PrismaClient,
  input: { actorId: string; guideId: string },
): Promise<GuideMutationResult> {
  const guide = await db.guide.findUnique({ where: { id: input.guideId } });
  if (!guide) return { ok: false, code: "not_found" };
  if (guide.status !== "draft") return { ok: false, code: "not_draft" };
  await db.$transaction(async (tx) => {
    await tx.guide.delete({ where: { id: input.guideId } });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "guide.deleted",
      entityType: "guide",
      entityId: input.guideId,
      before: { title: guide.title, section: guide.section },
    });
  });
  return { ok: true };
}
