import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Book } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import {
  getGuideBySlug,
  getGuideChapterNav,
  isGuideBookmarked,
  listSimilarGuides,
} from "@/lib/services/guides";
import { GUIDE_SECTION_LABEL } from "@/lib/constants";
import { renderLessonContent } from "@/components/blocks/lesson-renderer";
import { Watermark } from "@/components/features/watermark";
import { GuideBookmark } from "@/components/features/guide-bookmark";
import { ReadingSizeControl } from "@/components/features/reading-size-control";
import { LessonTocRail, LessonTocSheet } from "@/components/features/lesson-toc";
import { ReadingTracker } from "@/components/features/reading-tracker";
import { ReadingChapterHeader } from "@/components/features/reading-chapter-header";
import { ReadingNavCards, type ReadingNavItem } from "@/components/features/reading-nav-cards";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import type { ProgressSegment } from "@/components/ui/progress-bar";
import { sectionDepth } from "@/lib/utils/reading";
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

  const [bookmarked, rendered, similar, chapter] = await Promise.all([
    isGuideBookmarked(prisma, user.id, guide.id),
    renderLessonContent(guide.contentMd),
    // D6 (spec 13.1): «Похожие гайды» — others in the same section.
    listSimilarGuides(prisma, { section: guide.section, excludeId: guide.id }),
    // «Читалка v2»: «Глава X из Y» + карточки соседних глав раздела.
    getGuideChapterNav(prisma, { section: guide.section, guideId: guide.id }),
  ]);
  const { content, headings } = rendered;

  // Hierarchical back target (spec 12.1/C7): promoted sections → their landing page.
  const back =
    guide.section === "resume"
      ? { href: "/resume", label: "Резюме" }
      : guide.section === "legend"
        ? { href: "/legend", label: "Легенда" }
        : { href: "/guides", label: "Справочник" };

  // У справочника нет прогрессии и галок (spec 7.10) — сегменты показывают
  // только положение главы в разделе.
  const segments: ProgressSegment[] = Array.from({ length: chapter.total }, (_, i) =>
    i + 1 === chapter.index ? "current" : "todo",
  );

  const prevNav: ReadingNavItem | null = chapter.prev
    ? {
        href: `/guides/${chapter.prev.slug}`,
        title: chapter.prev.title,
        kicker: "Предыдущая глава",
      }
    : null;
  const nextNav: ReadingNavItem | null = chapter.next
    ? {
        href: `/guides/${chapter.next.slug}`,
        title: chapter.next.title,
        kicker: "Следующая глава",
      }
    : null;

  return (
    // The rail sits beside the column exactly as on a lesson; the sheet stays
    // hidden above 1180px so the two never show at once (audit 13.6).
    <ReadingTracker headingIds={headings.map((heading) => heading.id)}>
      <div className="flex gap-10">
        <article className="mx-auto w-full max-w-[680px] min-w-0 break-words">
          <BackButton href={back.href} label={back.label} className="mb-3" />
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Badge>{GUIDE_SECTION_LABEL[guide.section] ?? guide.section}</Badge>
            <div className="flex items-center gap-2">
              {/* D6 (spec 13.1): auto table of contents from headings (шторка). */}
              <LessonTocSheet headings={headings} title="В этом гайде" />
              <ReadingSizeControl initial={user.readingFontSize} />
              <GuideBookmark guideId={guide.id} initialBookmarked={bookmarked} />
            </div>
          </div>
          <ReadingChapterHeader
            kicker="Глава"
            index={chapter.index}
            total={chapter.total}
            segments={segments}
          />
          <h1 className="mb-4 text-[32px] leading-[1.2] font-semibold tracking-[-0.02em]">
            {guide.title}
          </h1>
          {/* Reading column with the always-present watermark layer (spec 5.7). */}
          <div className="relative">
            <Watermark email={session.user.email} />
            <div
              className="lesson-prose reading-article"
              data-reading-size={user.readingFontSize}
              data-section-level={sectionDepth(headings) ?? undefined}
            >
              {content}
            </div>
          </div>

          <ReadingNavCards prev={prevNav} next={nextNav} className="mt-10" />

          {similar.length > 0 && (
            <section className="border-border mt-8 border-t pt-5">
              <h2 className="text-text-3 mb-2.5 text-[13px] font-semibold tracking-[0.08em] uppercase">
                Похожие гайды
              </h2>
              <div className="flex flex-col gap-2">
                {similar.map((g) => (
                  <Link
                    key={g.id}
                    href={`/guides/${g.slug}`}
                    className="group border-border bg-surface-1 hover:border-border-strong flex items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[14px] transition-colors"
                  >
                    <Book
                      size={14}
                      strokeWidth={1.75}
                      className="text-text-3 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="group-hover:text-accent min-w-0 truncate">{g.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </article>
        <LessonTocRail headings={headings} title="В этом гайде" />
      </div>
    </ReadingTracker>
  );
}
