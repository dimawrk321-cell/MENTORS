import { NEW_GUIDE_DAYS } from "@/lib/constants";
import { computeReadingMinutes } from "@/lib/utils/markdown";

export interface GuideSectionSource {
  id: string;
  slug: string;
  title: string;
  contentMd: string;
  createdAt: Date;
}

export interface GuideSectionChapter {
  id: string;
  slug: string;
  title: string;
  minutes: number;
  isNew: boolean;
  bookmarked: boolean;
}

export interface GuideSectionModel {
  chapters: GuideSectionChapter[];
  focusIndex: number;
  focusKind: "recent" | "start";
  totalMinutes: number;
}

/**
 * C.10: RecentItem is a recency pointer, not reading progress. It selects the
 * one chapter offered as «Продолжить»; when there is no matching row, the first
 * published chapter is the honest starting point. No earlier chapter becomes
 * completed merely because a later one was opened.
 */
export function buildGuideSectionModel(input: {
  guides: readonly GuideSectionSource[];
  bookmarkedGuideIds: ReadonlySet<string>;
  recentGuideIds: readonly string[];
  now?: Date;
}): GuideSectionModel {
  const now = input.now ?? new Date();
  const newSince = new Date(now.getTime() - NEW_GUIDE_DAYS * 24 * 60 * 60 * 1000);
  const chapters = input.guides.map((guide) => ({
    id: guide.id,
    slug: guide.slug,
    title: guide.title,
    minutes: computeReadingMinutes(guide.contentMd),
    isNew: guide.createdAt >= newSince,
    bookmarked: input.bookmarkedGuideIds.has(guide.id),
  }));
  const recentId = input.recentGuideIds.find((id) => chapters.some((chapter) => chapter.id === id));
  const recentIndex = recentId ? chapters.findIndex((chapter) => chapter.id === recentId) : -1;

  return {
    chapters,
    focusIndex: recentIndex >= 0 ? recentIndex : 0,
    focusKind: recentIndex >= 0 ? "recent" : "start",
    totalMinutes: chapters.reduce((sum, chapter) => sum + chapter.minutes, 0),
  };
}
