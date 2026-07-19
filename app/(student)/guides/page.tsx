import type { Metadata } from "next";
import Link from "next/link";
import {
  Bookmark,
  BookMarked,
  Briefcase,
  ChevronRight,
  Feather,
  FileText,
  ListChecks,
  MessageCircleQuestion,
  Search,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import {
  listBookmarkedGuides,
  listPublishedGuides,
  searchGuidesByTitle,
  type GuideNavItem,
} from "@/lib/services/guides";
import { GUIDE_HUB_SECTIONS, GUIDE_SECTION_LABEL } from "@/lib/constants";
import { pluralRu } from "@/lib/utils/dates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Справочник",
};

interface GuidesIndexPageProps {
  searchParams: Promise<{ q?: string }>;
}

// Icons for the hub landing cards (spec 7.10 sections). tools became a course.
const SECTION_ICON: Record<string, LucideIcon> = {
  stages: ListChecks,
  ask_interviewer: MessageCircleQuestion,
  job_search: Briefcase,
};

interface HubCard {
  key: string;
  label: string;
  href: string;
  subtitle: string;
  icon: LucideIcon;
}

function GuideRow({ guide }: { guide: GuideNavItem }) {
  return (
    <Card interactive className="group relative">
      <CardContent className="flex items-center gap-3 p-3.5">
        <Link
          href={`/guides/${guide.slug}`}
          className="text-text-1 group-hover:text-accent text-[14px] font-medium after:absolute after:inset-0 after:content-['']"
        >
          {guide.title}
        </Link>
        <Badge className="ml-auto">{GUIDE_SECTION_LABEL[guide.section] ?? guide.section}</Badge>
      </CardContent>
    </Card>
  );
}

/** Large entry tile for the hub landing (spec 12.2/12.1-fix). */
function HubCardTile({ card }: { card: HubCard }) {
  const Icon = card.icon;
  return (
    <Link href={card.href} className="group">
      <Card interactive>
        <CardContent className="flex items-center gap-4 p-4">
          <div className="rounded-pill border-border bg-surface-2 flex size-10 shrink-0 items-center justify-center border">
            <Icon size={20} strokeWidth={1.75} className="text-text-2" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="group-hover:text-accent text-[15px] font-medium">{card.label}</p>
            <p className="text-text-3 text-[13px]">{card.subtitle}</p>
          </div>
          <ChevronRight
            size={18}
            strokeWidth={1.75}
            className="text-text-3 group-hover:text-text-2 shrink-0"
            aria-hidden="true"
          />
        </CardContent>
      </Card>
    </Link>
  );
}

/** /guides index (spec 7.10): search results, or the hub landing + bookmarks. */
export default async function GuidesIndexPage({ searchParams }: GuidesIndexPageProps) {
  const { user } = await requireStudentZone();
  const { q } = await searchParams;
  const query = q?.trim();

  if (query) {
    const results = await searchGuidesByTitle(prisma, query);
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[22px] font-semibold">Поиск: «{query}»</h1>
        {results.length === 0 ? (
          <Card>
            <EmptyState
              icon={Search}
              title="Ничего не нашлось"
              description="По этому запросу гайдов нет. Попробуй другое слово из заголовка."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {results.map((guide) => (
              <GuideRow key={guide.id} guide={guide} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const [bookmarks, guides] = await Promise.all([
    listBookmarkedGuides(prisma, user.id),
    listPublishedGuides(prisma),
  ]);

  // Hub landing cards (12.1-fix): the reference must not read as a wasteland for a
  // newcomer with no bookmarks and resume/legend flags off. Surface the always-on
  // hub sections that actually have guides (card → the section's first guide), plus
  // the gated Резюме / Легенда top-level pages when the student has them.
  const sectionCards: HubCard[] = GUIDE_HUB_SECTIONS.flatMap((section) => {
    const items = guides.filter((g) => g.section === section);
    if (items.length === 0) return [];
    return [
      {
        key: section,
        label: GUIDE_SECTION_LABEL[section] ?? section,
        href: `/guides/${items[0]!.slug}`,
        subtitle: `${items.length} ${pluralRu(items.length, "гайд", "гайда", "гайдов")}`,
        icon: SECTION_ICON[section] ?? BookMarked,
      },
    ];
  });
  const flagCards: HubCard[] = [
    ...(user.guidesResumeEnabled
      ? [
          {
            key: "resume",
            label: "Резюме",
            href: "/resume",
            subtitle: "Как собрать сильное резюме",
            icon: FileText,
          },
        ]
      : []),
    ...(user.guidesLegendEnabled
      ? [
          {
            key: "legend",
            label: "Легенда",
            href: "/legend",
            subtitle: "Как выстроить историю проектов",
            icon: Feather,
          },
        ]
      : []),
  ];
  const hubCards = [...sectionCards, ...flagCards];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[24px] font-semibold">Справочник</h1>
        <p className="text-text-2 mt-1 max-w-[60ch] text-[14px]">
          Гайды по этапам собеседований, вопросам интервьюеру и поиску работы. Открывай раздел и
          добавляй нужное в закладки.
        </p>
      </div>

      {hubCards.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Разделы</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {hubCards.map((card) => (
              <HubCardTile key={card.key} card={card} />
            ))}
          </div>
        </section>
      ) : (
        // Fresh install before content import — friendly, not a blank page.
        <Card>
          <EmptyState
            icon={BookMarked}
            title="Справочник скоро наполнится"
            description="Здесь появятся гайды по этапам собеседований, вопросам интервьюеру и поиску работы."
          />
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Bookmark size={16} strokeWidth={1.75} aria-hidden="true" />
          Закладки
        </h2>
        {bookmarks.length === 0 ? (
          <Card>
            <EmptyState
              icon={BookMarked}
              title="Пока нет закладок"
              description="Открой любой гайд и нажми на иконку закладки — он появится здесь."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {bookmarks.map((guide) => (
              <GuideRow key={guide.id} guide={guide} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
