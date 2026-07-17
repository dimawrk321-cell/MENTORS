import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { JOB_MAP } from "@/worker/registry";
import { getLockClient } from "@/worker/lib/lock-client";
import { withAdvisoryLock } from "@/worker/lib/advisory-lock";

// External cron trigger (spec 9): POST /api/cron/[job] authenticated with
// CRON_SECRET. The worker (node-cron) is the primary path; this is a manual/
// external fallback. Runs under the SAME advisory lock as the worker so a
// concurrent worker run doesn't double-execute the job's count-based dedup.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  const provided = header?.startsWith("Bearer ")
    ? header.slice(7)
    : req.headers.get("x-cron-secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const { job: name } = await ctx.params;
  const job = JOB_MAP.get(name);
  if (!job) {
    return NextResponse.json({ error: "Неизвестная задача" }, { status: 404 });
  }

  try {
    const outcome = await withAdvisoryLock(getLockClient(), name, () => job.run(prisma));
    if (!outcome.ran) {
      logger.info({ job: name, via: "cron-route" }, "job skipped — lock held by another run");
      return NextResponse.json({ ok: true, job: name, skipped: true });
    }
    logger.info({ job: name, result: outcome.result, via: "cron-route" }, "job done (external)");
    return NextResponse.json({ ok: true, job: name, result: outcome.result ?? null });
  } catch (err) {
    logger.error({ job: name, err, via: "cron-route" }, "job failed (external trigger)");
    return NextResponse.json({ ok: false, error: "Ошибка выполнения задачи" }, { status: 500 });
  }
}
