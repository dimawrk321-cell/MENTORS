import type { Db } from "@/lib/db";
import { pluralRu } from "@/lib/utils/dates";
import { getOwnerSignals } from "@/lib/services/settings";

// Owner signals (walk 13.3 block 4): critical Pulse events pushed to the owner's
// personal Telegram chat — only if the owner linked Telegram and the per-kind
// toggle (/admin/settings «Сигналы владельцу») is on. Delivered like any push:
// signalOwner enqueues a telegram-only notification row (no in-app copy, no quiet-
// hours deferral — these are operational) that telegramDispatch sends. Fuse-exempt
// (the `owner_*` type is unknown to NOTIFICATION_TYPES → always delivered).

export type OwnerSignalParams =
  | { kind: "security_flag"; flagType: string; studentName: string }
  | { kind: "no_show"; studentName: string; whenText: string }
  | { kind: "access_expired"; count: number }
  | { kind: "job_error"; jobName: string; message: string };

interface Rendered {
  title: string;
  body: string;
  url: string | null;
}

function renderOwnerSignal(params: OwnerSignalParams): Rendered {
  switch (params.kind) {
    case "security_flag":
      return {
        title: "Security-флаг",
        body: `${params.flagType} · ${params.studentName}`,
        url: "/admin/security",
      };
    case "no_show":
      return {
        title: "Ученик не пришёл на мок",
        body: `${params.studentName} · ${params.whenText}`,
        url: "/admin/interviews",
      };
    case "access_expired": {
      const students = pluralRu(params.count, "ученика", "учеников", "учеников");
      return {
        title: "Доступ истёк",
        body: `Сегодня доступ истёк у ${params.count} ${students}.`,
        url: "/admin/students",
      };
    }
    case "job_error":
      return {
        title: "Сбой фоновой задачи",
        body: `${params.jobName}: ${params.message.slice(0, 300)}`,
        url: null,
      };
  }
}

/**
 * Pushes an owner signal (spec block 4). No-op (returns false) when the kind's
 * toggle is off or the owner has not linked Telegram. Enqueues a telegram-only
 * row that telegramDispatch delivers; `now` keeps it test-injectable.
 */
export async function signalOwner(
  db: Db,
  params: OwnerSignalParams,
  opts: { now?: Date } = {},
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const signals = await getOwnerSignals(db);
  if (!signals[params.kind]) return false;

  const owner = await db.user.findFirst({
    where: { role: "owner" },
    select: { id: true, telegramLink: { select: { chatId: true } } },
  });
  if (!owner?.telegramLink) return false; // owner not linked → zero messages

  const { title, body, url } = renderOwnerSignal(params);
  await db.notification.create({
    data: {
      userId: owner.id,
      type: `owner_${params.kind}`,
      title,
      body,
      url,
      inApp: false,
      telegramPending: true,
      scheduledAt: now,
      createdAt: now,
    },
  });
  return true;
}
