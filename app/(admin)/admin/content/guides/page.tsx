import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { listGuidesAdmin } from "@/lib/services/guides";
import { ContentStudioTabs } from "@/components/features/content-studio-tabs";
import { GuidesBulkList } from "./guides-bulk-list";

export const metadata: Metadata = {
  title: "Справочник — контент-студия",
};

/** Guides CRUD tab of the content studio (spec 8.5): list by section, bulk ops (C2). */
export default async function AdminGuidesPage() {
  await requirePermission("content.manage");
  const guides = await listGuidesAdmin(prisma);

  return (
    <div className="flex flex-col gap-4">
      <ContentStudioTabs />
      <GuidesBulkList
        guides={guides.map((g) => ({
          id: g.id,
          slug: g.slug,
          section: g.section,
          title: g.title,
          status: g.status,
        }))}
      />
    </div>
  );
}
