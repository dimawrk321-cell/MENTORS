import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getRecordingForView } from "@/lib/services/library";
import {
  COMPANY_TYPE_LABEL,
  RECORDING_ACCESS_WARNING,
  RECORDING_OUTCOME_LABEL,
  recordingCardTitle,
} from "@/lib/constants";
import { RecordingEmbed, RecordingOpenLink } from "@/components/features/recording-viewer";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Запись собеседования",
};

interface RecordingPageProps {
  params: Promise<{ id: string }>;
}

const OUTCOME_VARIANT: Record<string, "success" | "danger" | "default"> = {
  offer: "success",
  reject: "danger",
  unknown: "default",
};

/** Просмотр записи (spec 7.9). Виден только при library_enabled. */
export default async function RecordingPage({ params }: RecordingPageProps) {
  const { user, session } = await requireStudentZone();
  if (!user.libraryEnabled) notFound();

  const { id } = await params;
  const recording = await getRecordingForView(prisma, id);
  if (!recording) notFound();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <BackButton href="/library" label="Библиотека" />

      <div>
        <h1 className="text-[24px] font-semibold">{recordingCardTitle(recording)}</h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Badge>{recording.durationMinutes} мин</Badge>
          <Badge>{COMPANY_TYPE_LABEL[recording.companyType] ?? recording.companyType}</Badge>
          <Badge variant={OUTCOME_VARIANT[recording.outcome] ?? "default"}>
            {RECORDING_OUTCOME_LABEL[recording.outcome] ?? recording.outcome}
          </Badge>
        </div>
      </div>

      {/* Предупреждение о личном доступе (spec 7.9) — всегда над плеером/ссылкой. */}
      <div className="rounded-control border-warning/40 bg-warning/8 text-warning flex items-start gap-2 border px-3 py-2.5 text-[13px]">
        <ShieldAlert size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{RECORDING_ACCESS_WARNING}</span>
      </div>

      {recording.embedUrl ? (
        <RecordingEmbed
          recordingId={recording.id}
          embedUrl={recording.embedUrl}
          watermarkEmail={session.user.email}
        />
      ) : (
        <div className="rounded-card border-border bg-surface-1 flex flex-col items-center gap-3 border p-8 text-center">
          <p className="text-text-2 text-[14px]">Запись открывается в новой вкладке на Я.Диске.</p>
          <RecordingOpenLink recordingId={recording.id} url={recording.url} />
        </div>
      )}
    </div>
  );
}
