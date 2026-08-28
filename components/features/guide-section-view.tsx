import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ArrowRight, BookOpen, FileText, LibraryBig, MessagesSquare } from "lucide-react";
import type { GuideSection } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  GUIDE_SECTION_COLOR,
  GUIDE_SECTION_DESCRIPTION,
  GUIDE_SECTION_LABEL,
} from "@/lib/constants";
import { buildGuideSectionModel, type GuideSectionModel } from "@/lib/utils/guide-section";
import { pluralRu } from "@/lib/utils/dates";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedProgress, type ProgressSegment } from "@/components/ui/progress-bar";
import { IconTile } from "@/components/features/icon-tile";
import { GuideSectionChapters } from "@/components/features/guide-section-chapters";

type PromotedGuideSection = Extract<GuideSection, "resume" | "legend">;

const SECTION_ICON: Record<PromotedGuideSection, LucideIcon> = {
  resume: FileText,
  legend: BookOpen,
};

export async function GuideSectionView({
  section,
  userId,
}: {
  section: PromotedGuideSection;
  userId: string;
}) {
  const [guideRows, bookmarkRows, recentRows] = await Promise.all([
    prisma.guide.findMany({
      where: { status: "published", section },
      orderBy: [{ order: "asc" }, { title: "asc" }],
      select: { id: true, slug: true, title: true, contentMd: true, createdAt: true },
    }),
    prisma.bookmark.findMany({
      where: { userId, guide: { status: "published", section } },
      select: { guideId: true },
    }),
    prisma.recentItem.findMany({
      where: { userId, itemType: "guide" },
      orderBy: { openedAt: "desc" },
      take: 20,
      select: { entityId: true },
    }),
  ]);

  const model = buildGuideSectionModel({
    guides: guideRows,
    bookmarkedGuideIds: new Set(bookmarkRows.map((row) => row.guideId)),
    recentGuideIds: recentRows.map((row) => row.entityId),
  });

  return <GuideSectionContent section={section} model={model} />;
}

export function GuideSectionContent({
  section,
  model,
}: {
  section: PromotedGuideSection;
  model: GuideSectionModel;
}) {
  const label = GUIDE_SECTION_LABEL[section] ?? section;
  const accentColor = GUIDE_SECTION_COLOR[section] ?? "var(--accent)";
  const SectionIcon = SECTION_ICON[section];
  const focusChapter = model.chapters[model.focusIndex];

  return (
    <div className="@container mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <header className="flex items-start gap-3.5" aria-label={`Раздел «${label}»`}>
        <IconTile icon={SectionIcon} colorVar={accentColor} size={44} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-text-3 mb-1 text-[10.5px] font-semibold tracking-[0.09em] uppercase">
            Раздел справочника
          </p>
          <PageHeader title={label} subtitle={GUIDE_SECTION_DESCRIPTION[section]} />
        </div>
      </header>

      {model.chapters.length === 0 || !focusChapter ? (
        <Card>
          <EmptyState
            icon={SectionIcon}
            title="Пока пусто"
            description="В этом разделе ещё нет материалов — они скоро появятся."
          />
        </Card>
      ) : (
        <>
          <section aria-labelledby="guide-continue-title">
            <Card catHover={accentColor} className="overflow-hidden">
              <CardContent className="flex flex-col gap-5 p-5 sm:p-6 @min-[680px]:flex-row @min-[680px]:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-text-3 text-[10.5px] font-semibold tracking-[0.09em] uppercase">
                    {model.focusKind === "recent" ? "Продолжить" : "Начать чтение"}
                  </p>
                  <h2
                    id="guide-continue-title"
                    className="text-text-1 mt-1 text-[19px] leading-[1.35] font-semibold tracking-[-0.015em]"
                  >
                    {focusChapter.title}
                  </h2>
                  <p className="text-text-3 mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px]">
                    <span>
                      Глава {model.focusIndex + 1} из {model.chapters.length}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{focusChapter.minutes} мин</span>
                  </p>
                  <SegmentedProgress
                    segments={model.chapters.map<ProgressSegment>((_, index) =>
                      index === model.focusIndex ? "current" : "todo",
                    )}
                    aria-label={`Глава ${model.focusIndex + 1} из ${model.chapters.length}`}
                    className="mt-4 max-w-[520px]"
                  />
                </div>
                <Button asChild variant="gradient" size="lg" className="w-full @min-[680px]:w-auto">
                  <Link href={`/guides/${focusChapter.slug}`}>
                    {model.focusKind === "recent" ? "Читать дальше" : "Начать"}
                    <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="guide-chapters-title">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <h2
                id="guide-chapters-title"
                className="text-[17px] font-semibold tracking-[-0.01em]"
              >
                Главы
              </h2>
              <p className="text-text-3 text-[12.5px]">
                {model.chapters.length} {pluralRu(model.chapters.length, "глава", "главы", "глав")}{" "}
                · {model.totalMinutes} мин чтения
              </p>
            </div>
            <GuideSectionChapters
              chapters={model.chapters}
              focusIndex={model.focusIndex}
              focusKind={model.focusKind}
              accentColor={accentColor}
            />
          </section>

          <nav
            aria-label="Следующие действия"
            className="grid grid-cols-1 gap-3 @min-[720px]:grid-cols-2"
          >
            <SectionLinkCard
              href="/mocks"
              icon={MessagesSquare}
              title="Проверить на моке"
              description="Отрепетируй ответы и получи обратную связь от интервьюера."
              color={accentColor}
            />
            <SectionLinkCard
              href="/guides"
              icon={LibraryBig}
              title="Весь справочник"
              description="Открой остальные гайды по собеседованиям и поиску работы."
              color="var(--accent)"
            />
          </nav>
        </>
      )}
    </div>
  );
}

function SectionLinkCard({
  href,
  icon,
  title,
  description,
  color,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <Card interactive catHover={color} className="group">
      <Link href={href} className="flex h-full items-center gap-3.5 p-4">
        <IconTile icon={icon} colorVar={color} />
        <span className="min-w-0 flex-1">
          <span className="text-text-1 group-hover:text-accent block text-[14.5px] font-semibold transition-colors">
            {title}
          </span>
          <span className="text-text-3 mt-0.5 block text-[12.5px] leading-[1.45]">
            {description}
          </span>
        </span>
        <ArrowRight
          size={18}
          strokeWidth={1.75}
          className="text-text-3 group-hover:text-text-1 shrink-0 transition-colors"
          aria-hidden="true"
        />
      </Link>
    </Card>
  );
}
