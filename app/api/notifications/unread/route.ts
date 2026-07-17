import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth/guards";
import { isApiRateLimited } from "@/lib/utils/rate-limit";
import { getRecentNotifications } from "@/lib/services/notifications";

// Bell data (spec 7.12): unread count + last 20 in-app notifications. Polled by
// the NotificationBell every 60s (no websockets). Force-dynamic — always fresh.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuth();
  if (auth.state !== "valid") {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (isApiRateLimited(`notifications:${auth.user.id}`)) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  const { items, unread } = await getRecentNotifications(prisma, auth.user.id);
  return NextResponse.json({ unread, items });
}
