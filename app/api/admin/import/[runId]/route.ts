import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { isApiRateLimited } from "@/lib/utils/rate-limit";
import { getImportRun } from "@/lib/services/notion-import/admin-import";

// Import-run status (spec 7.14 «поллинг статуса джобы»). admin+. Polled by the
// /admin/import page ~1/s while a run is active; returns the run row (status,
// counts, anomalies, rendered report). Force-dynamic — always fresh.

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const auth = await getAuth();
  if (auth.state !== "valid" || !hasPermission(auth.user, "content.manage")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  if (isApiRateLimited(`import-status:${auth.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }
  const { runId } = await ctx.params;
  const run = await getImportRun(prisma, runId);
  if (!run) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({ run });
}
