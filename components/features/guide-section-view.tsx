import Link from "next/link";
import { BookMarked } from "lucide-react";
import type { GuideSection } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listPublishedGuidesBySection } from "@/lib/services/guides";
import { GUIDE_SECTION_LABEL } from "@/lib/constants";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

// Section landing page body for a promoted reference section (spec 12.1/C5): lists
// the section's published guides. Shared by /resume and /legend. Gating (whether
// the section is visible at all) is enforced by the route page before rendering.
export async function GuideSectionView({ section }: { section: GuideSection }) {
  const guides = await listPublishedGuidesBySection(prisma, section);
  const label = GUIDE_SECTION_LABEL[section] ?? section;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
      <h1 className="text-[24px] font-semibold">{label}</h1>
      {guides.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookMarked}
            title="Пока пусто"
            description="В этом разделе ещё нет материалов — они скоро появятся."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-1.5">
          {guides.map((guide) => (
            <Card key={guide.id} interactive className="group">
              <Link href={`/guides/${guide.slug}`} className="flex items-center gap-3 p-3.5">
                <BookMarked
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="text-text-3 shrink-0"
                />
                <span className="text-text-1 group-hover:text-accent min-w-0 flex-1 truncate text-[15px]">
                  {guide.title}
                </span>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
