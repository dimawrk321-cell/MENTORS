import type { Metadata } from "next";
import { Megaphone } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminZone } from "@/lib/auth/guards";
import { getSegmentCourses, listAnnouncements } from "@/lib/services/announcements";
import { formatDateTimeRu } from "@/lib/utils/dates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AnnouncementForm } from "./announcement-form";

export const metadata: Metadata = { title: "Объявления" };

// /admin/announcements (spec 8.5): create banner|notification for a segment with
// a validity period; list with read reach. admin+ (spec 2).
export default async function AnnouncementsPage() {
  const { user } = await requireAdminZone("admin");
  const [items, courses] = await Promise.all([
    listAnnouncements(prisma),
    getSegmentCourses(prisma),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[24px] font-semibold">Объявления</h1>
        <p className="text-text-2 mt-1 text-[14px]">
          Баннер над контентом или уведомление в колокольчик — для всех, курса или тех, у кого мок
          на этой неделе.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Новое объявление</CardTitle>
        </CardHeader>
        <CardContent>
          <AnnouncementForm courses={courses} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>История</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Пока нет объявлений"
              description="Создай первое — оно появится у выбранного сегмента учеников."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-control border-border flex flex-col gap-2 border px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium">{item.title}</span>
                    <Badge variant={item.kind === "banner" ? "accent" : "default"}>
                      {item.kind === "banner" ? "Баннер" : "Уведомление"}
                    </Badge>
                    {item.active && <Badge variant="success">Активен</Badge>}
                  </div>
                  <div className="text-text-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    <span>Кому: {item.segmentLabel}</span>
                    <span>
                      {item.kind === "banner"
                        ? `Закрыли: ${item.reads} из ${item.reach}`
                        : `Доставлено: ${item.reach}`}
                    </span>
                    <span className="text-text-3">
                      {formatDateTimeRu(item.createdAt, user.timezone)} · {item.authorName}
                    </span>
                  </div>
                  {item.kind === "banner" && (
                    <div className="text-text-3 text-[12px]">
                      Показ с {formatDateTimeRu(item.startsAt, user.timezone)}
                      {item.endsAt ? ` по ${formatDateTimeRu(item.endsAt, user.timezone)}` : ""}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
