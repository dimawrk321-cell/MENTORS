import type { ReactNode } from "react";
import { AdminNav } from "@/components/layout/admin-sidebar";
import { CommandPalette } from "@/components/features/command-palette";
import { OfflineBanner } from "@/components/features/offline-banner";
import { requireAdminZone } from "@/lib/auth/guards";
import { effectivePermissions, isOwner } from "@/lib/auth/permissions";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "PRIME";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Layout guard (spec 3): staff (mentor+); pages/actions refine by permission
  // (walk 12.4/B2). The nav is filtered by the viewer's effective permissions.
  const { user } = await requireAdminZone();
  const permissions = [...effectivePermissions(user)];

  return (
    // Block layout on mobile (chip row above content), flex row with sidebar on md+.
    <div className="min-h-dvh md:flex">
      <OfflineBanner />
      <AdminNav
        brandName={brandName}
        permissions={permissions}
        isOwner={isOwner(user)}
        isInterviewer={user.isInterviewer}
        userName={user.name || user.email}
        role={user.role}
        theme={user.theme}
      />
      {/* min-w-0: flex items default to min-width:auto — without it a wide
          admin table (desktop, md+ flex row) bursts the page instead of
          scrolling inside its own container (spec 13). */}
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
      {/* Palette opens in the admin zone too, searching the same four types (spec 7.11). */}
      <CommandPalette zone="admin" />
    </div>
  );
}
