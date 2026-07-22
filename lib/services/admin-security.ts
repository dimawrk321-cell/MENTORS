import type { PrismaClient, SecurityFlagType } from "@prisma/client";
import type { Db } from "@/lib/db";
import { DAY_MS } from "@/lib/utils/dates";
import { writeAudit } from "@/lib/services/audit";
import { revokeSessionById } from "@/lib/services/sessions";

// D3 (spec 13.1): cross-student security aggregates for /admin/security. The
// per-student helpers (listActiveSessions, getStudentDetail) are single-user
// only, so these platform-wide reads are new. Read-only over `db` (testable),
// plus adminTerminateSession which revokes one session with an audit trail.

const STUDENT = { role: "student" as const };

// --- Active sessions of all students (paginated) ---

export interface AdminSessionRow {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  location: string; // city, falling back to ip when GeoIP is unconfigured
  ip: string;
  deviceLabel: string | null;
  lastActiveAt: Date;
  createdAt: Date;
}

export async function listActiveStudentSessions(
  db: Db,
  opts: { now?: Date; skip?: number; take?: number } = {},
): Promise<{ rows: AdminSessionRow[]; total: number }> {
  const now = opts.now ?? new Date();
  const where = {
    revokedAt: null,
    expiresAt: { gt: now },
    impersonatorId: null,
    user: STUDENT,
  };
  const [sessions, total] = await Promise.all([
    db.session.findMany({
      where,
      orderBy: { lastActiveAt: "desc" },
      skip: opts.skip ?? 0,
      take: opts.take ?? 30,
      select: {
        id: true,
        ip: true,
        city: true,
        lastActiveAt: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
        device: { select: { label: true } },
      },
    }),
    db.session.count({ where }),
  ]);
  return {
    total,
    rows: sessions.map((s) => ({
      id: s.id,
      studentId: s.user.id,
      studentName: s.user.name,
      studentEmail: s.user.email,
      location: s.city ?? s.ip,
      ip: s.ip,
      deviceLabel: s.device?.label ?? null,
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt,
    })),
  };
}

// --- Students with several devices in the last 7 days (churn / sharing signal) ---

export interface MultiDeviceRow {
  studentId: string;
  studentName: string;
  studentEmail: string;
  devices: { label: string; firstSeenAt: Date; lastSeenAt: Date }[];
}

/**
 * A new device registered in the window while the student still holds ≥2 devices
 * — the device-churn signal (a single steady phone+laptop pair is not flagged
 * unless one was just added). DEVICE_LIMIT caps rows at 2, so this catches the
 * "third device evicted the oldest" churn.
 */
export async function listMultiDeviceStudents(
  db: Db,
  opts: { now?: Date; days?: number } = {},
): Promise<MultiDeviceRow[]> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.days ?? 7) * DAY_MS);
  const users = await db.user.findMany({
    where: { ...STUDENT, devices: { some: { firstSeenAt: { gte: cutoff } } } },
    select: {
      id: true,
      name: true,
      email: true,
      devices: {
        select: { label: true, firstSeenAt: true, lastSeenAt: true },
        orderBy: { firstSeenAt: "desc" },
      },
    },
    take: 100,
  });
  return users
    .filter((u) => u.devices.length >= 2)
    .map((u) => ({
      studentId: u.id,
      studentName: u.name,
      studentEmail: u.email,
      devices: u.devices,
    }));
}

// --- Open security flags ---

export interface OpenFlagRow {
  id: string;
  type: SecurityFlagType;
  details: unknown;
  createdAt: Date;
  studentId: string;
  studentName: string;
  studentEmail: string;
}

export async function listOpenSecurityFlags(db: Db): Promise<OpenFlagRow[]> {
  const flags = await db.securityFlag.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      details: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  return flags.map((f) => ({
    id: f.id,
    type: f.type,
    details: f.details,
    createdAt: f.createdAt,
    studentId: f.user.id,
    studentName: f.user.name,
    studentEmail: f.user.email,
  }));
}

// --- Password resets in the last 30 days (self-serve rows + admin temp-resets) ---

export interface ResetRow {
  kind: "self" | "admin";
  studentName: string;
  studentEmail: string;
  at: Date;
}

/**
 * Both reset channels: self-serve «Забыл пароль» writes a PasswordReset row;
 * an admin temp-password reset does NOT (it audits `password.reset_to_temp`), so
 * counting the table alone would miss admin resets. This merges both, students only.
 */
export async function listRecentPasswordResets(
  db: Db,
  opts: { now?: Date; days?: number } = {},
): Promise<ResetRow[]> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.days ?? 30) * DAY_MS);

  const [selfRows, adminRows] = await Promise.all([
    db.passwordReset.findMany({
      where: { createdAt: { gte: cutoff }, user: STUDENT },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { createdAt: true, user: { select: { name: true, email: true } } },
    }),
    db.auditLog.findMany({
      where: { action: "password.reset_to_temp", createdAt: { gte: cutoff }, entityType: "user" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { createdAt: true, entityId: true },
    }),
  ]);

  // Resolve the admin-reset target users (audit stores only the entityId).
  const ids = [...new Set(adminRows.map((r) => r.entityId))];
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids }, ...STUDENT },
        select: { id: true, name: true, email: true },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const selfMapped: ResetRow[] = selfRows.map((r) => ({
    kind: "self",
    studentName: r.user.name,
    studentEmail: r.user.email,
    at: r.createdAt,
  }));
  const adminMapped: ResetRow[] = adminRows.flatMap((r) => {
    const u = byId.get(r.entityId);
    return u
      ? [{ kind: "admin" as const, studentName: u.name, studentEmail: u.email, at: r.createdAt }]
      : [];
  });
  const rows = [...selfMapped, ...adminMapped];
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());
  return rows;
}

// --- Terminate a single session (spec 13.1/D3) ---

export type TerminateSessionResult = { ok: true } | { ok: false; code: "not_found" };

export async function adminTerminateSession(
  db: PrismaClient,
  input: { actorId: string; sessionId: string; now?: Date },
): Promise<TerminateSessionResult> {
  const session = await db.session.findUnique({
    where: { id: input.sessionId },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!session || session.revokedAt !== null) return { ok: false, code: "not_found" };
  await db.$transaction(async (tx) => {
    await revokeSessionById(tx, input.sessionId, "admin_reset", input.now);
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "session.terminated",
      entityType: "user",
      entityId: session.userId,
      after: { sessionId: input.sessionId },
    });
  });
  return { ok: true };
}
