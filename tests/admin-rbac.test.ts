import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

// RBAC of the admin zone (spec 2/8.5, walk 12.4/B2). Actions now guard by
// PERMISSION (requireActionPermission) and owner-only actions by requireActionOwner.
// We assert the rejection path fires before any DB access. getAuth is mocked;
// hasPermission runs for real (pure — reads user.role/permissions), so a mentor
// carries the mentor preset (content.manage + students.view + analytics.view).

const ROLE_RANK: Record<Role, number> = { student: 0, mentor: 1, admin: 2, owner: 3 };
const getAuthMock = vi.fn();

vi.mock("@/lib/auth/guards", () => ({
  getAuth: () => getAuthMock(),
  hasRole: (user: { role: Role }, min: Role) => ROLE_RANK[user.role] >= ROLE_RANK[min],
}));

// Imported after the mock so action-helpers picks up the mocked getAuth.
const { loadMoreAuditAction } = await import("@/lib/actions/audit");
const { updateSettingsAction, updateXpMapAction, updateOperationalSettingsAction } =
  await import("@/lib/actions/settings");
const {
  extendAccessAction,
  blockStudentAction,
  resetStudentSessionsAction,
  resetStudentPasswordAction,
  impersonateAction,
} = await import("@/lib/actions/students");
const {
  createTeamMemberAction,
  setTeamRoleAction,
  setTeamPermissionsAction,
  setTeamInterviewerAction,
  blockTeamMemberAction,
  unblockTeamMemberAction,
  resetTeamMemberPasswordAction,
} = await import("@/lib/actions/team");
const { createAnnouncementAction } = await import("@/lib/actions/announcements");
const { upsertRubricAction } = await import("@/lib/actions/mock-admin");

function asRole(role: Role) {
  getAuthMock.mockResolvedValue({
    state: "valid",
    session: { id: "s1", impersonatorId: null },
    user: { id: "u1", role, permissions: null },
    accessExpired: false,
  });
}

function asPendingPassword(role: Role) {
  getAuthMock.mockResolvedValue({
    state: "valid",
    session: { id: "s1", impersonatorId: null },
    user: { id: "u1", role, permissions: null, mustChangePassword: true },
    accessExpired: false,
  });
}

function rejects(res: { ok: boolean; error?: { code: string } } | null): void {
  expect(res && res.ok).toBe(false); // also catches an unexpected null
  if (res && !res.ok) expect(res.error?.code).toBe("forbidden");
}

/** Passed the permission gate: not `ok`, but the failure is NOT a forbidden. */
function passesGate(res: { ok: boolean; error?: { code: string } } | null): void {
  expect(res && res.ok).toBe(false);
  if (res && !res.ok) expect(res.error?.code).not.toBe("forbidden");
}

describe("/admin/audit — owner-only", () => {
  it("отклоняет mentor и admin (нужен owner)", async () => {
    for (const role of ["mentor", "admin"] as const) {
      asRole(role);
      rejects(await loadMoreAuditAction({ cursor: "x" }));
    }
  });
});

describe("настройки / XP-карта / опер-правила (settings.manage)", () => {
  it("отклоняет student и mentor", async () => {
    for (const role of ["student", "mentor"] as const) {
      asRole(role);
      rejects(
        await updateSettingsAction({
          renewalContact: "",
          accessRulesText: "x",
          defaultCourseGating: "strict",
        }),
      );
      rejects(await updateXpMapAction({}));
      rejects(await updateOperationalSettingsAction({}));
    }
  });
});

describe("объявления (announcements.manage) / рубрики (interviews.manage)", () => {
  it("отклоняет mentor", async () => {
    asRole("mentor");
    rejects(await createAnnouncementAction({ title: "t", bodyMd: "b", kind: "banner" }));
    rejects(await upsertRubricAction({ type: "theory", criteria: [] }));
  });
});

describe("управление доступом ученика (students.manage)", () => {
  it("отклоняет student и mentor (просмотр есть, управление — нет)", async () => {
    for (const role of ["student", "mentor"] as const) {
      asRole(role);
      rejects(await extendAccessAction({ kind: "days", userId: "u", days: 30 }));
      rejects(await blockStudentAction("u"));
      rejects(await resetStudentSessionsAction("u"));
      rejects(await resetStudentPasswordAction("u"));
      rejects(await impersonateAction("u"));
    }
  });
});

describe("команда (owner-only) — spec 12.4/B3 owner-supremacy", () => {
  it("отклоняет mentor и admin у всех мутаций команды", async () => {
    for (const role of ["mentor", "admin"] as const) {
      asRole(role);
      rejects(await createTeamMemberAction(null, new FormData()));
      rejects(await setTeamRoleAction({ userId: "u", role: "admin" }));
      rejects(await setTeamPermissionsAction({ userId: "u", permissions: null }));
      rejects(await setTeamInterviewerAction({ userId: "u", isInterviewer: true }));
      rejects(await blockTeamMemberAction("u"));
      rejects(await unblockTeamMemberAction("u"));
      rejects(await resetTeamMemberPasswordAction("u"));
    }
  });

  it("owner проходит гейт прав (падает уже на валидации, не на forbidden)", async () => {
    asRole("owner");
    // Empty userId fails zod AFTER the owner gate — proves owner is not forbidden.
    passesGate(await setTeamRoleAction({ userId: "", role: "admin" }));
    passesGate(await setTeamInterviewerAction({ userId: "", isInterviewer: true }));
  });
});

describe("must_change_password gate (12.4/A2) — Server Actions", () => {
  it("blocks every action variant until the password is set (page guard is not enough)", async () => {
    // A pending-change admin: the action layer must reject before any permission
    // check — the /set-password redirect only guards page renders, not action POSTs.
    asPendingPassword("admin");
    const results = [
      await blockStudentAction("u"), // requireActionPermission
      await setTeamRoleAction({ userId: "u", role: "admin" }), // requireActionOwner
      await loadMoreAuditAction({ cursor: "x" }), // requireActionOwner
    ];
    for (const res of results) {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("password_change_required");
    }
  });
});
