import type { AnnouncementKind, PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";
import { notify } from "@/lib/services/notifications";

// Announcements (spec 6/8.5). Segments: "all" | "course:{id}" | "mock_this_week".
// kind=banner → dismissible strip above student content (announcement_reads);
// kind=notification → delivered through notify() at creation. Mutations audited.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type ParsedSegment =
  { kind: "all" } | { kind: "course"; courseId: string } | { kind: "mock_this_week" };

export function parseSegment(segment: string): ParsedSegment | null {
  if (segment === "all") return { kind: "all" };
  if (segment === "mock_this_week") return { kind: "mock_this_week" };
  if (segment.startsWith("course:")) {
    const courseId = segment.slice("course:".length);
    return courseId ? { kind: "course", courseId } : null;
  }
  return null;
}

/** Plain-text excerpt of markdown for the notification body/preview. */
export function plainExcerpt(md: string, max = 160): string {
  const text = md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → label
    .replace(/[#>*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Active students matched by a segment (for notification delivery + reach). */
export async function resolveSegmentUserIds(
  db: Db,
  segment: string,
  now: Date = new Date(),
): Promise<string[]> {
  const parsed = parseSegment(segment);
  if (!parsed) return [];
  const base = { role: "student" as const, status: "active" as const };

  if (parsed.kind === "all") {
    const rows = await db.user.findMany({ where: base, select: { id: true } });
    return rows.map((r) => r.id);
  }
  if (parsed.kind === "course") {
    const rows = await db.user.findMany({
      where: {
        ...base,
        lessonProgress: { some: { lesson: { module: { courseId: parsed.courseId } } } },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  const rows = await db.user.findMany({
    where: {
      ...base,
      bookings: {
        some: {
          status: "booked",
          slot: { startsAt: { gt: now, lte: new Date(now.getTime() + WEEK_MS) } },
        },
      },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Targeted membership check (banner gating) — cheaper than resolving the whole set. */
export async function isUserInSegment(
  db: Db,
  userId: string,
  segment: string,
  now: Date = new Date(),
): Promise<boolean> {
  const parsed = parseSegment(segment);
  if (!parsed) return false;
  const student = await db.user.findFirst({
    where: { id: userId, role: "student", status: "active" },
    select: { id: true },
  });
  if (!student) return false;
  if (parsed.kind === "all") return true;
  if (parsed.kind === "course") {
    const count = await db.lessonProgress.count({
      where: { userId, lesson: { module: { courseId: parsed.courseId } } },
    });
    return count > 0;
  }
  const count = await db.booking.count({
    where: {
      userId,
      status: "booked",
      slot: { startsAt: { gt: now, lte: new Date(now.getTime() + WEEK_MS) } },
    },
  });
  return count > 0;
}

export interface CreateAnnouncementInput {
  actorId: string;
  title: string;
  bodyMd: string;
  kind: AnnouncementKind;
  segment: string;
  startsAt: Date;
  endsAt: Date | null;
}

/**
 * Creates an announcement. kind=notification is delivered immediately through
 * notify() to the segment (DECISION: notification-kind delivers on creation;
 * starts_at/ends_at govern banner visibility). Audited (spec 7.13).
 */
export async function createAnnouncement(
  db: PrismaClient,
  input: CreateAnnouncementInput,
): Promise<{ id: string; delivered: number }> {
  const announcement = await db.announcement.create({
    data: {
      title: input.title,
      bodyMd: input.bodyMd,
      kind: input.kind,
      segment: input.segment,
      createdById: input.actorId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "announcement.created",
    entityType: "announcement",
    entityId: announcement.id,
    after: { kind: input.kind, segment: input.segment, title: input.title },
  });

  let delivered = 0;
  if (input.kind === "notification") {
    const userIds = await resolveSegmentUserIds(db, input.segment, input.startsAt);
    for (const userId of userIds) {
      await notify(db, userId, "announcement", {
        announcementId: announcement.id,
        title: input.title,
        bodyText: plainExcerpt(input.bodyMd),
        url: null,
      });
      delivered += 1;
    }
  }
  return { id: announcement.id, delivered };
}

export interface ActiveBanner {
  id: string;
  title: string;
  bodyMd: string;
}

/** Active banners in the student's segment that they haven't dismissed (spec 8.5). */
export async function getActiveBannersForUser(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<ActiveBanner[]> {
  const banners = await db.announcement.findMany({
    where: {
      kind: "banner",
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      reads: { none: { userId } },
    },
    orderBy: { startsAt: "desc" },
    select: { id: true, title: true, bodyMd: true, segment: true },
  });

  const active: ActiveBanner[] = [];
  for (const banner of banners) {
    if (await isUserInSegment(db, userId, banner.segment, now)) {
      active.push({ id: banner.id, title: banner.title, bodyMd: banner.bodyMd });
    }
  }
  return active;
}

/** Records a banner dismissal (spec 8.5: announcement_reads). Idempotent. */
export async function markAnnouncementRead(
  db: Db,
  userId: string,
  announcementId: string,
): Promise<void> {
  await db.announcementRead.upsert({
    where: { announcementId_userId: { announcementId, userId } },
    create: { announcementId, userId },
    update: {},
  });
}

export interface AnnouncementListItem {
  id: string;
  title: string;
  kind: AnnouncementKind;
  segment: string;
  segmentLabel: string;
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
  authorName: string;
  reads: number;
  reach: number;
  active: boolean;
}

/** Admin list with read reach (spec 8.5). */
export async function listAnnouncements(
  db: Db,
  now: Date = new Date(),
): Promise<AnnouncementListItem[]> {
  const announcements = await db.announcement.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { reads: true } }, createdBy: { select: { name: true } } },
  });

  // Resolve course titles once for course-segment labels.
  const courseIds = announcements
    .map((a) => parseSegment(a.segment))
    .filter((p): p is { kind: "course"; courseId: string } => p?.kind === "course")
    .map((p) => p.courseId);
  const courses = courseIds.length
    ? await db.course.findMany({
        where: { id: { in: courseIds } },
        select: { id: true, title: true },
      })
    : [];
  const courseTitle = new Map(courses.map((c) => [c.id, c.title]));

  const items: AnnouncementListItem[] = [];
  for (const a of announcements) {
    const parsed = parseSegment(a.segment);
    const segmentLabel =
      parsed?.kind === "all"
        ? "Все ученики"
        : parsed?.kind === "mock_this_week"
          ? "С моком на этой неделе"
          : parsed?.kind === "course"
            ? `Курс: ${courseTitle.get(parsed.courseId) ?? "неизвестный"}`
            : a.segment;
    const reach = (await resolveSegmentUserIds(db, a.segment, now)).length;
    const active =
      a.startsAt <= now && (a.endsAt === null || a.endsAt > now) && a.kind === "banner";
    items.push({
      id: a.id,
      title: a.title,
      kind: a.kind,
      segment: a.segment,
      segmentLabel,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      createdAt: a.createdAt,
      authorName: a.createdBy.name,
      reads: a._count.reads,
      reach,
      active,
    });
  }
  return items;
}

/** Published courses for the create-form segment picker. */
export async function getSegmentCourses(db: Db): Promise<{ id: string; title: string }[]> {
  return db.course.findMany({
    where: { status: "published" },
    orderBy: { order: "asc" },
    select: { id: true, title: true },
  });
}
