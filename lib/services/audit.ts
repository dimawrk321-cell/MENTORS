import type { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import { zonedDayUtcRange } from "@/lib/utils/dates";

// Audit service (spec 11): every admin/mentor/owner mutation records a
// before/after diff; retention is unlimited. System-initiated transitions use
// the affected user as actor with a `system.`-prefixed action (spec 7.1.5
// mentions system-marked audit entries; actor_id stays non-null).

export interface AuditEntry {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
    },
  });
}

// --- Stage 10.2: /admin/audit reader (owner-only, spec 8.5) ---

export interface AuditFilters {
  actorId?: string;
  entityType?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  take?: number;
}

export interface AuditRow {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

export const AUDIT_PAGE_SIZE = 50;

/**
 * «YYYY-MM-DD» date-filter strings → UTC instants bounding those local days in
 * the viewer's timezone (spec 0.6): the table renders createdAt in that TZ, so
 * the filter window must match. `to` is inclusive through the end of its local day.
 */
export function auditDateBounds(
  fromStr: string | undefined,
  toStr: string | undefined,
  timeZone: string,
): { from?: Date; to?: Date } {
  return {
    from: fromStr ? zonedDayUtcRange(fromStr, timeZone).start : undefined,
    // .end is the next local midnight (exclusive); −1ms → last instant of `to`'s day.
    to: toStr ? new Date(zonedDayUtcRange(toStr, timeZone).end.getTime() - 1) : undefined,
  };
}

/** Cursor-based audit page (spec 12: админ-таблицы — cursor-based). Read-only. */
export async function listAuditLog(
  db: Db,
  filters: AuditFilters = {},
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  const take = filters.take ?? AUDIT_PAGE_SIZE;
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1, // +1 to detect a next page
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    include: { actor: { select: { name: true } } },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  return {
    rows: page.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorName: r.actor.name,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt,
    })),
    nextCursor,
  };
}

/** Distinct actors and entity types for the audit filter selects. */
export async function getAuditFilterOptions(
  db: Db,
): Promise<{ actors: { id: string; name: string }[]; entityTypes: string[] }> {
  const [actors, types] = await Promise.all([
    db.auditLog.findMany({
      distinct: ["actorId"],
      select: { actorId: true, actor: { select: { name: true } } },
      orderBy: { actorId: "asc" },
    }),
    db.auditLog.findMany({
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    }),
  ]);
  return {
    actors: actors.map((a) => ({ id: a.actorId, name: a.actor.name })),
    entityTypes: types.map((t) => t.entityType),
  };
}
