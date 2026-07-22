import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getGuideForEditor } from "@/lib/services/guides";
import { GUIDE_SECTION_LABEL } from "@/lib/constants";
import { renderLessonContentSafe } from "@/components/blocks/lesson-renderer";
import { Watermark } from "@/components/features/watermark";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Предпросмотр гайда",
};

interface GuidePreviewPageProps {
  params: Promise<{ id: string }>;
}

// Live preview for the guide editor (spec 8.5), outside the admin chrome — the
// same LessonRenderer the student sees, so the preview is identical by construction.
export default async function GuidePreviewPage({ params }: GuidePreviewPageProps) {
  const { user } = await requirePermission("content.manage");
  const { id } = await params;
  const guide = await getGuideForEditor(prisma, id);
  if (!guide) notFound();

  const content = await renderLessonContentSafe(guide.contentMd);

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 py-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge>{GUIDE_SECTION_LABEL[guide.section] ?? guide.section}</Badge>
        {guide.status === "draft" && <Badge variant="warning">черновик</Badge>}
      </div>
      <h1 className="text-[32px] font-semibold">{guide.title}</h1>
      <div className="relative mt-5">
        <Watermark email={user.email} />
        <div className="lesson-prose">{content}</div>
      </div>
    </main>
  );
}
