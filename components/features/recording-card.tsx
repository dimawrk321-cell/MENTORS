import Link from "next/link";
import { Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { COMPANY_TYPE_LABEL, RECORDING_OUTCOME_LABEL, recordingCardTitle } from "@/lib/constants";

// RecordingCard (spec 5.3 / 7.9): anonymized label «{Этап} · {Направление} ·
// {грейд}» under a 16:9 thumbnail placeholder (records carry no poster — the
// viewer is a per-session watermarked stream), plus company type and a tone-
// coloured outcome badge. The whole card links to the viewing page.

export interface RecordingCardData {
  id: string;
  stage: string;
  direction: string;
  grade: string;
  outcome: string;
  companyType: string;
  durationMinutes: number;
}

const OUTCOME_VARIANT: Record<string, "success" | "danger" | "warning"> = {
  offer: "success",
  reject: "danger",
  unknown: "warning",
};

export function RecordingCard({ recording }: { recording: RecordingCardData }) {
  return (
    <Link
      href={`/library/${recording.id}`}
      className="group border-border bg-surface-1 shadow-card rounded-card ease-app hover:border-border-strong flex flex-col gap-3 border p-4 transition-[transform,border-color] duration-150 hover:-translate-y-0.5"
    >
      <div
        className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[10px]"
        style={{ background: "color-mix(in srgb, var(--accent) 8%, var(--surface-2))" }}
      >
        <span className="rounded-pill flex size-10 items-center justify-center bg-black/45 text-white">
          <Play
            size={16}
            fill="currentColor"
            strokeWidth={0}
            className="ml-0.5"
            aria-hidden="true"
          />
        </span>
        <span className="absolute right-2 bottom-2 rounded-[6px] bg-black/55 px-1.5 py-px text-[11px] text-white tabular-nums">
          {recording.durationMinutes} мин
        </span>
      </div>
      <div>
        <div className="group-hover:text-accent text-[14px] leading-snug font-semibold">
          {recordingCardTitle(recording)}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant={OUTCOME_VARIANT[recording.outcome] ?? "warning"}>
            {RECORDING_OUTCOME_LABEL[recording.outcome] ?? recording.outcome}
          </Badge>
          <Badge>{COMPANY_TYPE_LABEL[recording.companyType] ?? recording.companyType}</Badge>
        </div>
      </div>
    </Link>
  );
}
