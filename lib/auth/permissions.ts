import type { User } from "@prisma/client";
import {
  ADMIN_NO_ACCESS_PATH,
  ADMIN_SECTIONS,
  ALL_PERMISSIONS,
  ROLE_PRESETS,
  type Permission,
} from "@/lib/constants";

// Granular team permissions (spec 12.4/B1-B2). Pure, client-safe (Prisma types +
// constants only) — imported by server guards AND re-usable in the client sidebar.

type PermUser = Pick<User, "role" | "permissions">;

/** Validate the stored `users.permissions` Json into a permission set, or null (no override). */
export function parsePermissions(raw: unknown): Permission[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((k): k is Permission => (ALL_PERMISSIONS as string[]).includes(k as string));
}

/**
 * Effective permissions (spec 12.4/B1): owner → every permission; a per-user
 * override (JSON array) replaces the preset entirely; otherwise the role preset.
 * Students never carry permissions (any stray override is ignored).
 */
export function effectivePermissions(user: PermUser): Set<Permission> {
  if (user.role === "owner") return new Set(ALL_PERMISSIONS);
  if (user.role === "student") return new Set();
  const override = parsePermissions(user.permissions);
  if (override !== null) return new Set(override);
  return new Set(ROLE_PRESETS[user.role]);
}

/** owner passes every check unconditionally (owner-supremacy, spec 12.4/B2). */
export function hasPermission(user: PermUser, perm: Permission): boolean {
  if (user.role === "owner") return true;
  return effectivePermissions(user).has(perm);
}

export function isOwner(user: Pick<User, "role">): boolean {
  return user.role === "owner";
}

/** Staff = anyone who may enter the admin zone chrome (mentor/admin/owner). */
export function isStaff(user: Pick<User, "role">): boolean {
  return user.role !== "student";
}

/**
 * First admin section this user may open (spec 12.4/B2). Used as the redirect
 * target when a permission guard denies a page, and to land staff after login —
 * always resolves to a reachable page (the no-access screen when none qualify),
 * so denial never loops back onto a forbidden route.
 */
export function firstAllowedAdminPath(user: PermUser): string {
  for (const section of ADMIN_SECTIONS) {
    const visible = section.ownerOnly ? isOwner(user) : hasPermission(user, section.permission!);
    if (visible) return section.href;
  }
  return ADMIN_NO_ACCESS_PATH;
}
