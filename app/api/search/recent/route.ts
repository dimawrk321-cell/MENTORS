import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth/guards";
import { isApiRateLimited } from "@/lib/utils/rate-limit";
import { getContinueTarget } from "@/lib/services/dashboard";
import { getRecentItems } from "@/lib/services/recent";
import { getMockBookingAccess } from "@/lib/services/mock-access";

// Palette first-screen data (spec 7.11): «Продолжить урок» (hero logic) + the
// last opened entities. Fetched lazily when the palette opens (data is lazy,
// the component is preloaded — spec 5.3). Static actions (repetitions, book a
// mock, bookmarks) are client-side links and need no server data.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuth();
  if (auth.state !== "valid") {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (isApiRateLimited(`search:${auth.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  // Student-only first screen; admins/mentors have no student progress/recency
  // (they're gated out of the student zone) — the admin palette opens straight
  // to search (spec 7.11 integration note).
  if (auth.user.role !== "student") {
    return NextResponse.json({ continueLesson: null, recent: [], mockBookingOpen: true });
  }

  const [target, recent, mockAccess] = await Promise.all([
    getContinueTarget(prisma, auth.user.id),
    getRecentItems(prisma, {
      userId: auth.user.id,
      libraryEnabled: auth.user.libraryEnabled,
      guidesResumeEnabled: auth.user.guidesResumeEnabled,
      guidesLegendEnabled: auth.user.guidesLegendEnabled,
    }),
    // Заход B.1: действие «Забронировать мок» подчиняется тому же условию, что
    // и страница моков — палитра не должна вести в закрытый мастер.
    getMockBookingAccess(prisma, auth.user.id),
  ]);

  return NextResponse.json({
    continueLesson: target
      ? { title: target.lessonTitle, url: `/lessons/${target.lessonId}` }
      : null,
    recent,
    mockBookingOpen: mockAccess.open,
  });
}
