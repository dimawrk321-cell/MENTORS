import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getStudySessionReport } from "@/lib/services/study-sessions";
import { StudyCardDetails, StudySessionCard } from "@/components/features/study-session-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Учебные сессии" };
export default async function StudySessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; edit?: string }>;
}) {
  const { user } = await requireStudentZone();
  const { week, edit } = await searchParams;
  const report = await getStudySessionReport(prisma, user.id, new Date(), week);
  const unfinished =
    report.cards.find((c) => !["completed", "abandoned"].includes(c.status)) ?? null;
  const active =
    unfinished ?? report.cards.find((c) => c.id === edit && c.status === "completed") ?? null;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Учебные сессии" subtitle="План, рефлексия и история в одном месте" />
      <StudySessionCard initial={active} />
      <Card>
        <CardHeader>
          <CardTitle>Эта неделя</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric value={report.summary.count} label="занятий" />
            <Metric value={`${report.summary.totalMinutes} мин`} label="всего" />
            <Metric
              value={
                report.summary.averageMinutes === null
                  ? "—"
                  : `${report.summary.averageMinutes} мин`
              }
              label="в среднем"
            />
            <Metric value={report.summary.distractions} label="отвлечений" />
          </div>
          <p className="text-text-2 mt-4 text-[13px]">
            Могу объяснить: {report.summary.explain.yes} · частично:{" "}
            {report.summary.explain.partial} · пока нет: {report.summary.explain.no} ·
            незавершённых: {report.summary.unfinished}
          </p>
          {report.summary.gaps.length > 0 && (
            <p className="text-text-2 mt-2 text-[13px]">
              Повторяется:{" "}
              {report.summary.gaps.map((g) => `${g.text} (${g.sessionIds.length})`).join(" · ")}
            </p>
          )}
          {report.summary.topics.length > 0 && (
            <p className="text-text-2 mt-2 text-[13px]">
              Темы:{" "}
              {report.summary.topics
                .slice(0, 5)
                .map((g) => g.text)
                .join(" · ")}
            </p>
          )}
          {report.summary.nextActions.length > 0 && (
            <p className="text-text-2 mt-2 text-[13px]">
              Следующие действия:{" "}
              {report.summary.nextActions
                .slice(0, 5)
                .map((g) => g.text)
                .join(" · ")}
            </p>
          )}
        </CardContent>
      </Card>
      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold">История карточек</h2>
        {report.cards.length ? (
          report.cards.map((card) => (
            <StudyCardDetails key={card.id} card={card} editable={card.status === "completed"} />
          ))
        ) : (
          <p className="text-text-2 text-[14px]">
            Здесь появятся завершённые и прерванные занятия.
          </p>
        )}
      </section>
    </div>
  );
}
function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="bg-surface-2 rounded-control p-3">
      <p className="text-[20px] font-semibold">{value}</p>
      <p className="text-text-2 text-[12px]">{label}</p>
    </div>
  );
}
