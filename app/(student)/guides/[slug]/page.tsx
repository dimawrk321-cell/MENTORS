import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getGuideBySlug, isGuideBookmarked } from "@/lib/services/guides";
import { GUIDE_SECTION_LABEL } from "@/lib/constants";
import { renderLessonContent } from "@/components/blocks/lesson-renderer";
import { Watermark } from "@/components/features/watermark";
import { GuideBookmark } from "@/components/features/guide-bookmark";
import { Badge } from "@/components/ui/badge";

interface GuidePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = await prisma.guide.findFirst({
    where: { slug, status: "published" },
    select: { title: true },
  });
  return { title: guide?.title ?? "Справочник" };
}

/** Guide reading page (spec 7.10): same reading column + watermark, no progression. */
export default async function GuidePage({ params }: GuidePageProps) {
  const { user, session } = await requireStudentZone();
  const { slug } = await params;
  const guide = await getGuideBySlug(prisma, slug);
  if (!guide) notFound();
  // Per-student section access (spec 12.1/C3): Резюме/Легенда are gated — a
  // disabled section must not be reachable by direct slug URL either.
  if (guide.section === "resume" && !user.guidesResumeEnabled) notFound();
  if (guide.section === "legend" && !user.guidesLegendEnabled) notFound();

  const [bookmarked, { content }] = await Promise.all([
    isGuideBookmarked(prisma, user.id, guide.id),
    renderLessonContent(guide.contentMd),
  ]);

  return (
    <article className="mx-auto w-full max-w-[680px]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Badge>{GUIDE_SECTION_LABEL[guide.section] ?? guide.section}</Badge>
        <GuideBookmark guideId={guide.id} initialBookmarked={bookmarked} />
      </div>
      <h1 className="text-[32px] font-semibold">{guide.title}</h1>
      {/* Reading column with the always-present watermark layer (spec 5.7). */}
      <div className="relative mt-5">
        <Watermark email={session.user.email} />
        <div className="lesson-prose">{content}</div>
      </div>
    </article>
  );
}
