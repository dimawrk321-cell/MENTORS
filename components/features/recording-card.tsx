import Link from "next/link";
import { Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { COMPANY_TYPE_LABEL, RECORDING_OUTCOME_LABEL, recordingCardTitle } from "@/lib/constants";

// RecordingCard (spec 5.3 / 7.9): anonymized label «{Этап} · {Направление} ·
// {грейд}», duration, company type and an outcome badge — the whole card links
// to the viewing page.

export interface RecordingCardData {
  id: string;
  stage: string;
  direction: string;
  grade: string;
  outcome: string;
  companyType: string;
  durationMinutes: number;
}

const OUTCOME_VARIANT: Record<string, "success" | "danger" | "default"> = {
  offer: "success",
  reject: "danger",
  unknown: "default",
};

export function RecordingCard({ recording }: { recording: RecordingCardData }) {
  return (
    <Card interactive className="group relative h-full">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <Link
          href={`/library/${recording.id}`}
          className="text-text-1 group-hover:text-accent text-[15px] leading-snug font-medium after:absolute after:inset-0 after:content-['']"
        >
          {recordingCardTitle(recording)}
        </Link>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <Badge>
            <Clock size={12} strokeWidth={1.75} aria-hidden="true" className="mr-1" />
            {recording.durationMinutes} мин
          </Badge>
          <Badge>{COMPANY_TYPE_LABEL[recording.companyType] ?? recording.companyType}</Badge>
          <Badge variant={OUTCOME_VARIANT[recording.outcome] ?? "default"} className="ml-auto">
            {RECORDING_OUTCOME_LABEL[recording.outcome] ?? recording.outcome}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
