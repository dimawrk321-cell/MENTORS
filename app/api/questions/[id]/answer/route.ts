import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth/guards";
import { isApiRateLimited } from "@/lib/utils/rate-limit";
import { renderCatalogAnswer } from "@/lib/services/questions";

// Lazy catalog answer (walk 13.5): the эталон (+ full question for a long one) is
// rendered HERE on first row expand — never in the /questions SSR — so the catalog
// first load stays light. Authorized GET, published questions only, read-only
// (mutations stay Server Actions, spec 3); the client caches the response per row.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (auth.state !== "valid") {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  // Spec 7.2: API — 120 rpm per user.
  if (isApiRateLimited(`qanswer:${auth.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  const { id } = await params;
  const answer = await renderCatalogAnswer(prisma, id);
  if (!answer) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  return NextResponse.json(answer);
}
