import type { Metadata } from "next";
import { ShieldOff } from "lucide-react";
import { requireAdminZone } from "@/lib/auth/guards";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Нет доступа",
  robots: { index: false, follow: false },
};

/**
 * Fallback landing for a staff member with no accessible admin section (walk
 * 12.4/B2). Permission guards redirect here instead of looping on a forbidden
 * route; only staff reach it (requireAdminZone).
 */
export default async function NoAccessPage() {
  await requireAdminZone();

  return (
    <>
      {/* The page IS an empty state, and EmptyState renders an h3 by contract
          («empty states sit inside page sections, never as the page title»).
          A visually hidden h1 gives the document an outline without touching
          the prototype's look. */}
      <h1 className="sr-only">Нет доступа</h1>
      <Card>
        <EmptyState
          icon={ShieldOff}
          tone="warning"
          title="Нет доступа к разделам"
          description="У тебя пока нет прав ни на один раздел админки. Обратись к владельцу платформы."
        />
      </Card>
    </>
  );
}
