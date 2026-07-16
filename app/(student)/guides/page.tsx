import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark, BookMarked, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import {
  listBookmarkedGuides,
  searchGuidesByTitle,
  type GuideNavItem,
} from "@/lib/services/guides";
import { GUIDE_SECTION_LABEL } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Справочник",
};

interface GuidesIndexPageProps {
  searchParams: Promise<{ q?: string }>;
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

/** /guides index (spec 7.10): search results, or bookmarks + a short intro. */
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

  const bookmarks = await listBookmarkedGuides(prisma, user.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[24px] font-semibold">Справочник</h1>
        <p className="text-text-2 mt-1 max-w-[60ch] text-[14px]">
          Гайды по инструментам, резюме, легенде, этапам собеседований и поиску работы. Выбери
          раздел слева или добавляй нужное в закладки.
        </p>
      </div>

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
