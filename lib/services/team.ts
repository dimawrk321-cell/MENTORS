import { Prisma, type PrismaClient, type User } from "@prisma/client";
import type { Db } from "@/lib/db";
import type { Permission, TeamRole } from "@/lib/constants";
import { generateTempPassword, paletteIndex } from "@/lib/utils/crypto";
import { hashPassword } from "@/lib/utils/password";
import { writeAudit } from "@/lib/services/audit";
import { revokeSessions } from "@/lib/services/sessions";

// Team & granular permissions (spec 12.4/B). Owner-supremacy is enforced by the
// action layer (requireActionOwner) PLUS `loadManageableMember` here: every
// mutation targets a NON-owner staff member (mentor|admin). Since there is exactly
// one owner and only the owner calls these, that also blocks the owner acting on
// self (demote/block) — the owner row is `is_owner`, never manageable. Every
// mutation writes an audit row with a before/after diff.

export type TeamMemberActionResult =
  { ok: true } | { ok: false; code: "not_found" | "is_owner" | "wrong_status" };

/** Loads a target that owner-management may act on: an existing mentor|admin. */
async function loadManageableMember(
  db: Db,
  userId: string,
): Promise<{ ok: true; user: User } | { ok: false; code: "not_found" | "is_owner" }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, code: "not_found" };
  // owner is never mutable through team management (owner-supremacy / no self-demote).
  if (user.role === "owner") return { ok: false, code: "is_owner" };
  if (user.role !== "mentor" && user.role !== "admin") return { ok: false, code: "not_found" };
  return { ok: true, user };
}

function overrideArray(raw: Prisma.JsonValue | null): string[] | null {
  return Array.isArray(raw) ? (raw as string[]) : null;
}

// --- Create (spec 12.4/B4): «Добавить участника» — same credential flow ---

export type CreateTeamMemberResult =
  { ok: true; userId: string; tempPassword: string } | { ok: false; code: "exists" };

/**
 * Creates a staff account with admin-issued credentials (walk 12.4/B4). Same
 * temp-password + must_change_password flow as a student, role mentor|admin +
 * optional is_interviewer; no invite row, no welcome email, no 90-day clock.
 */
export async function createTeamMember(
  db: PrismaClient,
  input: {
    actorId: string;
    email: string;
    name: string;
    role: TeamRole;
    isInterviewer: boolean;
  },
): Promise<CreateTeamMemberResult> {
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) return { ok: false, code: "exists" };

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const { user } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        isInterviewer: input.isInterviewer,
        status: "invited",
        passwordHash,
        mustChangePassword: true,
        avatarColor: paletteIndex(input.email),
      },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "team.member_created",
      entityType: "user",
      entityId: user.id,
      after: {
        email: input.email,
        name: input.name,
        role: input.role,
        isInterviewer: input.isInterviewer,
      },
    });
    return { user };
  });

  return { ok: true, userId: user.id, tempPassword };
}

// --- Mutations (owner-only; each audits before/after) ---

export async function setTeamMemberRole(
  db: PrismaClient,
  input: { actorId: string; userId: string; role: TeamRole },
): Promise<TeamMemberActionResult> {
  const m = await loadManageableMember(db, input.userId);
  if (!m.ok) return m;
  if (m.user.role === input.role) return { ok: true };

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { role: input.role } });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "team.role_changed",
      entityType: "user",
      entityId: input.userId,
      before: { role: m.user.role },
      after: { role: input.role },
    });
  });
  return { ok: true };
}

export async function setTeamMemberPermissions(
  db: PrismaClient,
  input: { actorId: string; userId: string; permissions: Permission[] | null },
): Promise<TeamMemberActionResult> {
  const m = await loadManageableMember(db, input.userId);
  if (!m.ok) return m;

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      // null clears the override (back to the role preset).
      data: { permissions: input.permissions === null ? Prisma.DbNull : input.permissions },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "team.permissions_changed",
      entityType: "user",
      entityId: input.userId,
      before: { permissions: overrideArray(m.user.permissions) },
      after: { permissions: input.permissions },
    });
  });
  return { ok: true };
}

export async function setTeamMemberInterviewer(
  db: PrismaClient,
  input: { actorId: string; userId: string; isInterviewer: boolean },
): Promise<TeamMemberActionResult> {
  const m = await loadManageableMember(db, input.userId);
  if (!m.ok) return m;
  if (m.user.isInterviewer === input.isInterviewer) return { ok: true };

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { isInterviewer: input.isInterviewer },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "team.interviewer_changed",
      entityType: "user",
      entityId: input.userId,
      before: { isInterviewer: m.user.isInterviewer },
      after: { isInterviewer: input.isInterviewer },
    });
  });
  return { ok: true };
}

export async function blockTeamMember(
  db: PrismaClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<TeamMemberActionResult> {
  const now = input.now ?? new Date();
  const m = await loadManageableMember(db, input.userId);
  if (!m.ok) return m;
  if (m.user.status === "blocked") return { ok: false, code: "wrong_status" };

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { status: "blocked" } });
    await revokeSessions(tx, {
      userId: input.userId,
      reason: "blocked",
      includeImpersonated: true,
      now,
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "team.blocked",
      entityType: "user",
      entityId: input.userId,
      before: { status: m.user.status },
      after: { status: "blocked" },
    });
  });
  return { ok: true };
}

export async function unblockTeamMember(
  db: PrismaClient,
  input: { actorId: string; userId: string },
): Promise<TeamMemberActionResult> {
  const m = await loadManageableMember(db, input.userId);
  if (!m.ok) return m;
  if (m.user.status !== "blocked") return { ok: false, code: "wrong_status" };
  // Staff have no access clock: restore to active once they have activated,
  // else back to invited (created-with-credentials, never logged in).
  const restored = m.user.activatedAt === null ? "invited" : "active";

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { status: restored } });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "team.unblocked",
      entityType: "user",
      entityId: input.userId,
      before: { status: "blocked" },
      after: { status: restored },
    });
  });
  return { ok: true };
}

export type ResetTeamPasswordResult =
  | { ok: true; tempPassword: string; email: string }
  | { ok: false; code: "not_found" | "is_owner" | "not_eligible" };

/** Reset a staff member's password to a fresh temp password (owner-only, 12.4/B3). */
export async function resetTeamMemberPassword(
  db: PrismaClient,
  input: { actorId: string; userId: string },
): Promise<ResetTeamPasswordResult> {
  const m = await loadManageableMember(db, input.userId);
  if (!m.ok) return m;
  if (!m.user.passwordHash || m.user.status === "blocked") {
    return { ok: false, code: "not_eligible" };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { passwordHash, mustChangePassword: true },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "team.password_reset",
      entityType: "user",
      entityId: input.userId,
    });
  });
  return { ok: true, tempPassword, email: m.user.email };
}

// --- Query for /admin/team (spec 12.4/B4) ---

export type TeamMember = Pick<
  User,
  | "id"
  | "email"
  | "name"
  | "role"
  | "isInterviewer"
  | "status"
  | "lastSeenAt"
  | "permissions"
  | "avatarColor"
  | "activatedAt"
>;

export async function listTeam(db: Db): Promise<TeamMember[]> {
  return db.user.findMany({
    where: { role: { in: ["mentor", "admin", "owner"] } },
    // owner first (enum order student<mentor<admin<owner ⇒ desc), then oldest first.
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isInterviewer: true,
      status: true,
      lastSeenAt: true,
      permissions: true,
      avatarColor: true,
      activatedAt: true,
    },
  });
}
