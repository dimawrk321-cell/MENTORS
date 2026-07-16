import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth/guards";
import { isApiRateLimited } from "@/lib/utils/rate-limit";
import { getContinueTarget } from "@/lib/services/dashboard";
import { getRecentItems } from "@/lib/services/recent";

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
    return NextResponse.json({ continueLesson: null, recent: [] });
  }

  const [target, recent] = await Promise.all([
    getContinueTarget(prisma, auth.user.id, auth.user.track),
    getRecentItems(prisma, {
      userId: auth.user.id,
      libraryEnabled: auth.user.libraryEnabled,
    }),
  ]);

  return NextResponse.json({
    continueLesson: target
      ? { title: target.lessonTitle, url: `/lessons/${target.lessonId}` }
      : null,
    recent,
  });
}
