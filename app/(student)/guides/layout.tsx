import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { listPublishedGuides } from "@/lib/services/guides";
import { GuidesNav } from "@/components/features/guides-nav";

// Guides zone layout (spec 7.10): section sidebar (desktop) / accordion (mobile)
// shared by /guides and /guides/[slug].
export default async function GuidesLayout({ children }: { children: ReactNode }) {
  await requireStudentZone();
  const guides = await listPublishedGuides(prisma);

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
      <GuidesNav guides={guides} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
