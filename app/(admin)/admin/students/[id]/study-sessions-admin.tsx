import { AlertTriangle } from "lucide-react";
import type { getStudySessionReport } from "@/lib/services/study-sessions";
import { StudyCardDetails } from "@/components/features/study-session-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Report = Awaited<ReturnType<typeof getStudySessionReport>>;
export function StudySessionsAdmin({ report }: { report: Report }) {
  const linkedIds = new Set(report.flags.flatMap((flag) => flag.sessionIds));
  const cards = report.cards.filter((card, index) => index < 10 || linkedIds.has(card.id));
  return (
    <Card id="study-sessions">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Учебные сессии</CardTitle>
          <Badge>{report.summary.week}</Badge>
        </div>
        <CardDescription>Полная карточка, недельная аналитика и прозрачные сигналы</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric value={report.summary.count} label="занятий" />
          <Metric value={`${report.summary.totalMinutes} мин`} label="всего" />
          <Metric
            value={
              report.summary.averageMinutes === null ? "—" : `${report.summary.averageMinutes} мин`
            }
            label="в среднем"
          />
          <Metric value={report.summary.distractions} label="отвлечений" />
        </div>
        <p className="text-text-2 text-[13px]">
          Объяснит: {report.summary.explain.yes} · частично: {report.summary.explain.partial} · пока
          нет: {report.summary.explain.no}. Вовремя: {report.summary.onTime}, позже:{" "}
          {report.summary.late}. Незавершённых: {report.summary.unfinished}.
        </p>
        {report.flags.length > 0 && (
          <div className="flex flex-col gap-2">
            {report.flags.map((f) => (
              <p
                key={f.type}
                className="bg-warning/10 text-warning rounded-control flex items-start gap-2 p-3 text-[13px]"
              >
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                {f.reason} ·{" "}
                <a className="underline" href={`#study-session-${f.sessionIds[0] ?? "s"}`}>
                  карточки
                </a>
              </p>
            ))}
          </div>
        )}
        {report.summary.gaps.length > 0 && (
          <p className="text-text-2 text-[13px]">
            Повторяющиеся пробелы:{" "}
            {report.summary.gaps.map((g) => `${g.text} (${g.sessionIds.length})`).join(" · ")}
          </p>
        )}
        {report.summary.topics.length > 0 && (
          <p className="text-text-2 text-[13px]">
            Ключевые темы:{" "}
            {report.summary.topics
              .slice(0, 5)
              .map((g) => g.text)
              .join(" · ")}
          </p>
        )}
        {report.summary.nextActions.length > 0 && (
          <p className="text-text-2 text-[13px]">
            Следующие действия:{" "}
            {report.summary.nextActions
              .slice(0, 5)
              .map((g) => g.text)
              .join(" · ")}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {cards.map((card) => (
            <StudyCardDetails key={card.id} card={card} />
          ))}
          {report.cards.length === 0 && (
            <p className="text-text-2 text-[13px]">Ученик пока не создавал карточки.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="bg-surface-2 rounded-control p-3">
      <p className="text-[19px] font-semibold">{value}</p>
      <p className="text-text-2 text-[12px]">{label}</p>
    </div>
  );
}
