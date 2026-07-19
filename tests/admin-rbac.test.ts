import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

// RBAC вкладки админки (spec 2/8.5): /admin/audit — owner-only; /admin/settings —
// admin+. Проверяем, что actions отклоняют недостаточную роль (rejection-путь
// срабатывает до обращения к БД). getAuth мокается — тест не требует контекста запроса.

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
  inviteMentorAction,
  extendAccessAction,
  blockStudentAction,
  resetStudentSessionsAction,
  impersonateAction,
} = await import("@/lib/actions/students");
const { createAnnouncementAction } = await import("@/lib/actions/announcements");
const { upsertRubricAction } = await import("@/lib/actions/mock-admin");

function asRole(role: Role) {
  getAuthMock.mockResolvedValue({
    state: "valid",
    session: { id: "s1", impersonatorId: null },
    user: { id: "u1", role },
    accessExpired: false,
  });
}

describe("/admin/audit — owner-only", () => {
  it("отклоняет mentor и admin (нужен owner)", async () => {
    for (const role of ["mentor", "admin"] as const) {
      asRole(role);
      const res = await loadMoreAuditAction({ cursor: "x" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("forbidden");
    }
  });
});

describe("/admin/settings — admin+", () => {
  it("отклоняет student и mentor (нужен admin+)", async () => {
    for (const role of ["student", "mentor"] as const) {
      asRole(role);
      const res = await updateSettingsAction({
        renewalContact: "",
        accessRulesText: "x",
        defaultCourseGating: "strict",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("forbidden");
    }
  });
});

// Stage 12.2/4.4: rejection tests for the rest of the privileged mutations so a
// future refactor can't silently drop a guard (matrix, spec 2). The role check
// runs before parseInput/DB, so minimal/empty inputs reach the guard first.
function rejects(res: { ok: boolean; error?: { code: string } } | null): void {
  expect(res && res.ok).toBe(false); // also catches an unexpected null
  if (res && !res.ok) expect(res.error?.code).toBe("forbidden");
}

describe("роль-ассайнмент (invite mentor) — owner-only", () => {
  it("отклоняет mentor и admin (нужен owner)", async () => {
    for (const role of ["mentor", "admin"] as const) {
      asRole(role);
      rejects(await inviteMentorAction(null, new FormData()));
    }
  });
});

describe("доступ ученика (продление/блок/сессии/impersonation) — admin+", () => {
  it("отклоняет student и mentor (нужен admin+)", async () => {
    for (const role of ["student", "mentor"] as const) {
      asRole(role);
      rejects(await extendAccessAction({ userId: "u", days: 30 }));
      rejects(await blockStudentAction("u"));
      rejects(await resetStudentSessionsAction("u"));
      rejects(await impersonateAction("u"));
    }
  });
});

describe("объявления / XP-карта / опер-правила / рубрики — admin+", () => {
  it("отклоняет mentor (нужен admin+)", async () => {
    asRole("mentor");
    rejects(await createAnnouncementAction({ title: "t", bodyMd: "b", kind: "banner" }));
    rejects(await updateXpMapAction({}));
    rejects(await updateOperationalSettingsAction({}));
    rejects(await upsertRubricAction({ type: "theory", criteria: [] }));
  });
});
