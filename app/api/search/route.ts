import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth/guards";
import { isApiRateLimited } from "@/lib/utils/rate-limit";
import { emitEvent } from "@/lib/services/events";
import { search } from "@/lib/services/search";
import { logger } from "@/lib/logger";
import { SEARCH_MAX_QUERY, SEARCH_MIN_QUERY } from "@/lib/constants";

// Search route handler (spec 7.11 / 9). Authorized GET; debounce is on the
// client. Mutations stay Server Actions — this is a read, so it lives here
// because the palette needs a URL to fetch (spec 3).

export const dynamic = "force-dynamic";

const querySchema = z.string().trim().min(SEARCH_MIN_QUERY).max(SEARCH_MAX_QUERY);

export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (auth.state !== "valid") {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Spec 7.2: API — 120 rpm per user.
  if (isApiRateLimited(`search:${auth.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  const parsed = querySchema.safeParse(request.nextUrl.searchParams.get("q") ?? "");
  if (!parsed.success) {
    // Too short (client guards ≥2) or too long — nothing to search.
    return NextResponse.json({ groups: [], fuzzy: false });
  }
  const q = parsed.data;

  const startedAt = performance.now();
  const result = await search(prisma, { q, libraryEnabled: auth.user.libraryEnabled });
  const tookMs = Math.round(performance.now() - startedAt);

  // Perf budget is 150ms (spec 12); surface slow queries in the logs.
  logger.info({ qLength: q.length, groups: result.groups.length, tookMs }, "search.performed");

  // DECISION (spec 7.11): search.performed carries only q length / group count /
  // took_ms — never the query text (privacy). Skipped under impersonation so an
  // admin's read-only browsing doesn't pollute the student's analytics.
  if (auth.session.impersonatorId === null) {
    await emitEvent(
      prisma,
      "search.performed",
      { qLength: q.length, groupsCount: result.groups.length, tookMs },
      { userId: auth.user.id },
    );
  }

  return NextResponse.json(result);
}
