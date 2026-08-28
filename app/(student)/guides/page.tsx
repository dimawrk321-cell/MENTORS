import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { searchGuidesByContent, type GuideContentHit } from "@/lib/services/guides";
import { GUIDE_SECTION_COLOR, GUIDE_SECTION_LABEL, NEW_GUIDE_DAYS } from "@/lib/constants";
import { computeReadingMinutes } from "@/lib/utils/markdown";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  GuidesCatalog,
  type GuideCatalogItem,
  type GuideContinueItem,
} from "@/components/features/guides-catalog";

export const metadata: Metadata = { title: "Справочник" };

interface GuidesIndexPageProps {
  searchParams: Promise<{ q?: string }>;
}

const ALWAYS_VISIBLE_SECTIONS = ["stages", "ask_interviewer", "job_search"] as const;

function GuideHitRow({ hit }: { hit: GuideContentHit }) {
  return (
    <Card interactive className="group relative">
      <CardContent className="flex flex-col gap-1 p-3.5">
        <div className="flex items-center gap-3">
          <Link
            href={`/guides/${hit.slug}`}
            className="text-text-1 group-hover:text-accent text-[14px] font-medium after:absolute after:inset-0 after:content-['']"
          >
            {hit.title}
          </Link>
          <Badge className="ml-auto">{GUIDE_SECTION_LABEL[hit.section] ?? hit.section}</Badge>
        </div>
        {hit.snippet && (
          <p
            className="text-text-3 [&_mark]:bg-accent/20 [&_mark]:text-text-1 text-[13px] [&_mark]:rounded-[2px] [&_mark]:px-0.5"
            // renderSnippet escapes everything except its own <mark> tags.
            dangerouslySetInnerHTML={{ __html: hit.snippet }}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default async function GuidesIndexPage({ searchParams }: GuidesIndexPageProps) {
  const { user } = await requireStudentZone();
  const query = (await searchParams).q?.trim();

  // Preserve the existing content FTS contract for links from the reading-page
  // sidebar and CommandPalette. The new field below filters titles client-side.
  if (query) {
    const results = await searchGuidesByContent(prisma, query, {
      resume: user.guidesResumeEnabled,
      legend: user.guidesLegendEnabled,
    });
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={`Поиск: «${query}»`} />
        {results.length === 0 ? (
          <Card>
            <EmptyState
              icon={Search}
              title="Ничего не нашлось"
              description="По этому запросу гайдов нет. Попробуй другое слово."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {results.map((hit) => (
              <GuideHitRow key={hit.id} hit={hit} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const sectionOrder = [
    ...ALWAYS_VISIBLE_SECTIONS,
    ...(user.guidesResumeEnabled ? (["resume"] as const) : []),
    ...(user.guidesLegendEnabled ? (["legend"] as const) : []),
  ];
  const [rows, bookmarkRows, recentRows] = await Promise.all([
    prisma.guide.findMany({
      where: { status: "published", section: { in: sectionOrder } },
      orderBy: [{ section: "asc" }, { order: "asc" }, { title: "asc" }],
      select: {
        id: true,
        slug: true,
        section: true,
        title: true,
        contentMd: true,
        createdAt: true,
      },
    }),
    prisma.bookmark.findMany({
      where: { userId: user.id, guide: { status: "published", section: { in: sectionOrder } } },
      select: { guideId: true },
    }),
    prisma.recentItem.findMany({
      where: { userId: user.id, itemType: "guide" },
      orderBy: { openedAt: "desc" },
      take: 20,
      select: { entityId: true },
    }),
  ]);

  const bookmarkIds = new Set(bookmarkRows.map((row) => row.guideId));
  const newSince = new Date(Date.now() - NEW_GUIDE_DAYS * 24 * 60 * 60 * 1000);
  const guides: GuideCatalogItem[] = rows.map((guide) => ({
    id: guide.id,
    slug: guide.slug,
    section: guide.section,
    title: guide.title,
    minutes: computeReadingMinutes(guide.contentMd),
    isNew: guide.createdAt >= newSince,
    bookmarked: bookmarkIds.has(guide.id),
  }));

  const latestId = recentRows.find((recent) =>
    guides.some((guide) => guide.id === recent.entityId),
  )?.entityId;
  const latest = latestId ? guides.find((guide) => guide.id === latestId) : null;
  let continueGuide: GuideContinueItem | null = null;
  if (latest) {
    const chapters = guides.filter((guide) => guide.section === latest.section);
    continueGuide = {
      ...latest,
      chapter: Math.max(1, chapters.findIndex((guide) => guide.id === latest.id) + 1),
      chapterTotal: chapters.length,
    };
  }

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      <PageHeader
        title="Справочник"
        subtitle="Практические гайды по собеседованиям, резюме и поиску работы."
      />
      <GuidesCatalog
        guides={guides}
        sectionOrder={sectionOrder}
        sectionColors={GUIDE_SECTION_COLOR}
        continueGuide={continueGuide}
      />
    </div>
  );
}
