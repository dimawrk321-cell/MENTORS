import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getGuideBySlug, isGuideBookmarked, listSimilarGuides } from "@/lib/services/guides";
import { GUIDE_SECTION_LABEL } from "@/lib/constants";
import { renderLessonContent } from "@/components/blocks/lesson-renderer";
import { Watermark } from "@/components/features/watermark";
import { GuideBookmark } from "@/components/features/guide-bookmark";
import { ReadingSizeControl } from "@/components/features/reading-size-control";
import { LessonTocSheet } from "@/components/features/lesson-toc";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import Link from "next/link";

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

  const [bookmarked, rendered, similar] = await Promise.all([
    isGuideBookmarked(prisma, user.id, guide.id),
    renderLessonContent(guide.contentMd),
    // D6 (spec 13.1): «Похожие гайды» — others in the same section.
    listSimilarGuides(prisma, { section: guide.section, excludeId: guide.id }),
  ]);
  const { content, headings } = rendered;

  // Hierarchical back target (spec 12.1/C7): promoted sections → their landing page.
  const back =
    guide.section === "resume"
      ? { href: "/resume", label: "Резюме" }
      : guide.section === "legend"
        ? { href: "/legend", label: "Легенда" }
        : { href: "/guides", label: "Справочник" };

  // B4 (spec 13.1): left-align the reading column in the guides content column
  // (drop mx-auto) — centering a 680px article inside the rail-offset column made
  // it look «съехавшим в центр» vs every other page.
  return (
    <article className="w-full max-w-[680px]">
      <BackButton href={back.href} label={back.label} className="mb-3" />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Badge>{GUIDE_SECTION_LABEL[guide.section] ?? guide.section}</Badge>
        <div className="flex items-center gap-2">
          {/* D6 (spec 13.1): auto table of contents from headings (шторка). */}
          <LessonTocSheet headings={headings} />
          <ReadingSizeControl initial={user.readingFontSize} />
          <GuideBookmark guideId={guide.id} initialBookmarked={bookmarked} />
        </div>
      </div>
      <h1 className="text-[32px] font-semibold">{guide.title}</h1>
      {/* Reading column with the always-present watermark layer (spec 5.7). */}
      <div className="relative mt-5">
        <Watermark email={session.user.email} />
        <div className="lesson-prose" data-reading-size={user.readingFontSize}>
          {content}
        </div>
      </div>

      {similar.length > 0 && (
        <section className="border-border mt-10 border-t pt-6">
          <h2 className="text-text-2 mb-3 text-[13px] font-medium tracking-wide uppercase">
            Похожие гайды
          </h2>
          <ul className="flex flex-col gap-1.5">
            {similar.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/guides/${g.slug}`}
                  className="text-text-1 hover:text-accent text-[14px]"
                >
                  {g.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
