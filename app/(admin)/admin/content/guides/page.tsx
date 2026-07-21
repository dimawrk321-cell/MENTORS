import type { Metadata } from "next";
import Link from "next/link";
import { BookMarked } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { listGuidesAdmin } from "@/lib/services/guides";
import { GUIDE_SECTIONS, GUIDE_SECTION_LABEL } from "@/lib/constants";
import { ContentStudioTabs } from "@/components/features/content-studio-tabs";
import { CreateGuideButton } from "@/components/features/create-guide-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Справочник — контент-студия",
};

/** Guides CRUD tab of the content studio (spec 8.5): list by section. */
export default async function AdminGuidesPage() {
  await requirePermission("content.manage");
  const guides = await listGuidesAdmin(prisma);

  return (
    <div className="flex flex-col gap-4">
      <ContentStudioTabs />

      <div className="flex flex-col gap-5">
        {GUIDE_SECTIONS.map((section) => {
          const items = guides.filter((g) => g.section === section);
          return (
            <section key={section} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold">
                  {GUIDE_SECTION_LABEL[section] ?? section}
                  <span className="text-text-3 ml-2 text-[13px] font-normal">{items.length}</span>
                </h2>
                <CreateGuideButton section={section} />
              </div>
              {items.length === 0 ? (
                // Spec 5.5/12.1-A4: anchored empty state per section (was a bare line).
                <div className="rounded-control border-border text-text-3 border border-dashed px-3 py-4 text-center text-[13px]">
                  В этой секции пока нет гайдов — создай первый кнопкой выше.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {items.map((guide) => (
                    <Card key={guide.id} interactive className="group relative">
                      <Link
                        href={`/admin/content/guides/${guide.id}`}
                        className="flex items-center gap-3 p-3"
                      >
                        <BookMarked
                          size={15}
                          strokeWidth={1.75}
                          aria-hidden="true"
                          className="text-text-3 shrink-0"
                        />
                        <span className="text-text-1 group-hover:text-accent min-w-0 flex-1 truncate text-[14px]">
                          {guide.title}
                        </span>
                        <span className="text-text-3 text-[12px]">/{guide.slug}</span>
                        {guide.status === "published" ? (
                          <Badge variant="success">опубликован</Badge>
                        ) : (
                          <Badge>черновик</Badge>
                        )}
                      </Link>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
