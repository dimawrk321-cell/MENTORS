import type { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";

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
