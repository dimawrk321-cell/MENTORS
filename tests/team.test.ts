import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { verifyPassword } from "@/lib/utils/password";
import { effectivePermissions } from "@/lib/auth/permissions";
import { addDays } from "@/lib/utils/dates";
import {
  blockTeamMember,
  createTeamMember,
  listTeam,
  resetTeamMemberPassword,
  setTeamMemberInterviewer,
  setTeamMemberPermissions,
  setTeamMemberRole,
  unblockTeamMember,
} from "@/lib/services/team";

// Team & granular permissions (spec 12.4/B): owner-supremacy invariants + audited
// mutations. Every action here is owner-only at the action layer (admin-rbac.test),
// and the service refuses to touch a non-manageable target (owner / student).

const NOW = new Date("2026-07-21T12:00:00.000Z");
const owner = () => createTestUser({ email: "owner@example.com", role: "owner", name: "Оунер" });

describe("createTeamMember (12.4/B4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates staff with a temp password + must_change; audits without plaintext", async () => {
    const o = await owner();
    const res = await createTeamMember(testDb, {
      actorId: o.id,
      email: "m@example.com",
      name: "Ментор",
      role: "mentor",
      isInterviewer: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const user = await testDb.user.findUniqueOrThrow({ where: { id: res.userId } });
    expect(user.role).toBe("mentor");
    expect(user.isInterviewer).toBe(true);
    expect(user.status).toBe("invited");
    expect(user.mustChangePassword).toBe(true);
    expect(await verifyPassword(user.passwordHash!, res.tempPassword)).toBe(true);

    const audit = await testDb.auditLog.findFirst({
      where: { action: "team.member_created", entityId: res.userId },
    });
    expect(audit?.actorId).toBe(o.id);
    expect(JSON.stringify(audit)).not.toContain(res.tempPassword);
  });

  it("rejects a duplicate email", async () => {
    const o = await owner();
    await createTeamMember(testDb, {
      actorId: o.id,
      email: "m@example.com",
      name: "",
      role: "mentor",
      isInterviewer: false,
    });
    const dup = await createTeamMember(testDb, {
      actorId: o.id,
      email: "m@example.com",
      name: "",
      role: "admin",
      isInterviewer: false,
    });
    expect(dup.ok).toBe(false);
  });
});

describe("owner-supremacy — non-manageable targets (12.4/B3)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses to change the owner (is_owner) or a student (not_found)", async () => {
    const o = await owner();
    const student = await createTestUser({ email: "s@example.com", role: "student" });

    const onOwner = await setTeamMemberRole(testDb, {
      actorId: o.id,
      userId: o.id,
      role: "admin",
    });
    expect(onOwner.ok).toBe(false);
    if (!onOwner.ok) expect(onOwner.code).toBe("is_owner");

    const onStudent = await setTeamMemberRole(testDb, {
      actorId: o.id,
      userId: student.id,
      role: "admin",
    });
    expect(onStudent.ok).toBe(false);
    if (!onStudent.ok) expect(onStudent.code).toBe("not_found");

    // The owner's role is untouched.
    expect((await testDb.user.findUniqueOrThrow({ where: { id: o.id } })).role).toBe("owner");
  });
});

describe("team mutations (audited)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const mentor = () =>
    createTestUser({ email: "m@example.com", role: "mentor", name: "Ментор", status: "active" });

  it("setTeamMemberRole: mentor→admin with a before/after audit", async () => {
    const o = await owner();
    const m = await mentor();
    const res = await setTeamMemberRole(testDb, { actorId: o.id, userId: m.id, role: "admin" });
    expect(res.ok).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: m.id } })).role).toBe("admin");
    const audit = await testDb.auditLog.findFirst({
      where: { action: "team.role_changed", entityId: m.id },
    });
    expect(audit?.before).toEqual({ role: "mentor" });
    expect(audit?.after).toEqual({ role: "admin" });
  });

  it("setTeamMemberPermissions: override replaces the preset, null clears it", async () => {
    const o = await owner();
    const m = await mentor();
    await setTeamMemberPermissions(testDb, {
      actorId: o.id,
      userId: m.id,
      permissions: ["settings.manage"],
    });
    let fresh = await testDb.user.findUniqueOrThrow({ where: { id: m.id } });
    expect(fresh.permissions).toEqual(["settings.manage"]);
    expect([...effectivePermissions(fresh)]).toEqual(["settings.manage"]);

    await setTeamMemberPermissions(testDb, { actorId: o.id, userId: m.id, permissions: null });
    fresh = await testDb.user.findUniqueOrThrow({ where: { id: m.id } });
    expect(fresh.permissions).toBeNull();
    // Back to the mentor preset.
    expect([...effectivePermissions(fresh)].sort()).toEqual(
      ["analytics.view", "content.manage", "students.view"].sort(),
    );
  });

  it("setTeamMemberInterviewer toggles the flag and audits it", async () => {
    const o = await owner();
    const m = await mentor();
    await setTeamMemberInterviewer(testDb, { actorId: o.id, userId: m.id, isInterviewer: true });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: m.id } })).isInterviewer).toBe(true);
    const audit = await testDb.auditLog.findFirst({
      where: { action: "team.interviewer_changed", entityId: m.id },
    });
    expect(audit?.after).toEqual({ isInterviewer: true });
  });

  it("block revokes sessions; unblock restores active for an activated member", async () => {
    const o = await owner();
    const m = await createTestUser({
      email: "m@example.com",
      role: "mentor",
      status: "active",
      activatedAt: NOW,
    });
    await testDb.session.create({
      data: {
        userId: m.id,
        tokenHash: "team-session",
        ip: "127.0.0.1",
        expiresAt: addDays(NOW, 30),
        lastActiveAt: NOW,
      },
    });

    const blocked = await blockTeamMember(testDb, { actorId: o.id, userId: m.id, now: NOW });
    expect(blocked.ok).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("blocked");
    expect(await testDb.session.count({ where: { userId: m.id, revokedAt: null } })).toBe(0);

    const unblocked = await unblockTeamMember(testDb, { actorId: o.id, userId: m.id });
    expect(unblocked.ok).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("active");
  });

  it("resetTeamMemberPassword sets a temp password + must_change; refuses the owner", async () => {
    const o = await owner();
    const m = await createTestUser({
      email: "m@example.com",
      role: "mentor",
      status: "active",
      passwordHash: "existing-hash",
    });
    const res = await resetTeamMemberPassword(testDb, { actorId: o.id, userId: m.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const fresh = await testDb.user.findUniqueOrThrow({ where: { id: m.id } });
    expect(fresh.mustChangePassword).toBe(true);
    expect(await verifyPassword(fresh.passwordHash!, res.tempPassword)).toBe(true);

    const onOwner = await resetTeamMemberPassword(testDb, { actorId: o.id, userId: o.id });
    expect(onOwner.ok).toBe(false);
    if (!onOwner.ok) expect(onOwner.code).toBe("is_owner");
  });

  it("listTeam returns staff with the owner first", async () => {
    const o = await owner();
    await mentor();
    const team = await listTeam(testDb);
    expect(team.map((t) => t.role)).toContain("owner");
    expect(team[0]!.id).toBe(o.id); // owner first
  });
});
