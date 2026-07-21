import { describe, it, expect } from "vitest";
import type { User } from "@prisma/client";
import {
  effectivePermissions,
  firstAllowedAdminPath,
  hasPermission,
  isOwner,
  isStaff,
  parsePermissions,
} from "@/lib/auth/permissions";
import { ALL_PERMISSIONS, ROLE_PRESETS } from "@/lib/constants";
import { generateTempPassword, TEMP_PASSWORD_ALPHABET } from "@/lib/utils/crypto";

// Granular team permissions (spec 12.4/B1-B2): the role × override × page matrix.

type PermUser = Pick<User, "role" | "permissions">;
const u = (role: string, permissions: unknown = null): PermUser =>
  ({ role, permissions }) as unknown as PermUser;
const eff = (user: PermUser) => [...effectivePermissions(user)].sort();

describe("effectivePermissions — presets", () => {
  it("owner gets every permission", () => {
    expect(eff(u("owner"))).toEqual([...ALL_PERMISSIONS].sort());
  });
  it("admin preset = all; mentor preset = content.manage + students.view + analytics.view", () => {
    expect(eff(u("admin"))).toEqual([...ROLE_PRESETS.admin].sort());
    expect(eff(u("mentor"))).toEqual([...ROLE_PRESETS.mentor].sort());
    expect(eff(u("mentor"))).toEqual(["analytics.view", "content.manage", "students.view"].sort());
  });
  it("student carries no permissions (even with a stray override)", () => {
    expect(eff(u("student"))).toEqual([]);
    expect(eff(u("student", ["settings.manage"]))).toEqual([]);
  });
});

describe("effectivePermissions — per-user override replaces the preset", () => {
  it("a mentor override REPLACES the preset (not a delta)", () => {
    // Mentor granted only settings.manage loses content.manage/students.view/analytics.view.
    expect(eff(u("mentor", ["settings.manage"]))).toEqual(["settings.manage"]);
  });
  it("empty override = zero permissions", () => {
    expect(eff(u("admin", []))).toEqual([]);
  });
  it("owner ignores the override entirely (still every permission)", () => {
    expect(eff(u("owner", []))).toEqual([...ALL_PERMISSIONS].sort());
  });
});

describe("hasPermission", () => {
  it("owner passes any permission unconditionally", () => {
    for (const p of ALL_PERMISSIONS) expect(hasPermission(u("owner", []), p)).toBe(true);
  });
  it("mentor: content.manage yes, settings.manage no, interviews.manage no", () => {
    expect(hasPermission(u("mentor"), "content.manage")).toBe(true);
    expect(hasPermission(u("mentor"), "settings.manage")).toBe(false);
    expect(hasPermission(u("mentor"), "interviews.manage")).toBe(false);
  });
  it("admin has interviews.manage and announcements.manage", () => {
    expect(hasPermission(u("admin"), "interviews.manage")).toBe(true);
    expect(hasPermission(u("admin"), "announcements.manage")).toBe(true);
  });
});

describe("parsePermissions", () => {
  it("keeps only valid keys; non-array is null", () => {
    expect(parsePermissions(["content.manage", "bogus"])).toEqual(["content.manage"]);
    expect(parsePermissions([])).toEqual([]);
    expect(parsePermissions(null)).toBeNull();
    expect(parsePermissions("x")).toBeNull();
    expect(parsePermissions(undefined)).toBeNull();
  });
});

describe("firstAllowedAdminPath — never loops onto a forbidden route", () => {
  it("owner and mentor land on the dashboard (analytics.view)", () => {
    expect(firstAllowedAdminPath(u("owner"))).toBe("/admin");
    expect(firstAllowedAdminPath(u("mentor"))).toBe("/admin");
  });
  it("content-only (no analytics.view) lands on /admin/content", () => {
    expect(firstAllowedAdminPath(u("mentor", ["content.manage"]))).toBe("/admin/content");
  });
  it("zero permissions lands on the no-access page", () => {
    expect(firstAllowedAdminPath(u("admin", []))).toBe("/admin/no-access");
  });
});

describe("isStaff / isOwner", () => {
  it("staff = mentor/admin/owner; owner only for owner", () => {
    expect(isStaff(u("student"))).toBe(false);
    expect(isStaff(u("mentor"))).toBe(true);
    expect(isOwner(u("admin"))).toBe(false);
    expect(isOwner(u("owner"))).toBe(true);
  });
});

describe("generateTempPassword (12.4/A1)", () => {
  it("is 12 chars from the readable alphabet, excluding O/0/l/1/I", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword();
      expect(pw).toHaveLength(12);
      for (const ch of pw) expect(TEMP_PASSWORD_ALPHABET).toContain(ch);
    }
    for (const glyph of ["O", "0", "l", "1", "I"]) {
      expect(TEMP_PASSWORD_ALPHABET).not.toContain(glyph);
    }
  });
  it("is not constant across calls", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateTempPassword()));
    expect(values.size).toBeGreaterThan(1);
  });
});
