import type { Metadata } from "next";
import Link from "next/link";
import type {
  CompanyType,
  ContentStatus,
  RecordingDirection,
  RecordingGrade,
  RecordingOutcome,
  RecordingStage,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminZone } from "@/lib/auth/guards";
import { listRecordingsAdmin } from "@/lib/services/library";
import { formatDateRu } from "@/lib/utils/dates";
import {
  COMPANY_TYPES,
  COMPANY_TYPE_LABEL,
  isChecklistComplete,
  isLinkStale,
  LINK_STALE_DAYS,
  RECORDING_DIRECTIONS,
  RECORDING_DIRECTION_LABEL,
  RECORDING_GRADES,
  RECORDING_GRADE_LABEL,
  RECORDING_OUTCOMES,
  RECORDING_OUTCOME_LABEL,
  RECORDING_STAGES,
  RECORDING_STAGE_LABEL,
  recordingCardTitle,
} from "@/lib/constants";
import {
  RecordingFormDialog,
  type RecordingFormValue,
} from "@/components/features/recording-form-dialog";
import { RecordingStatusButton } from "@/components/features/recording-status-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import { Library } from "lucide-react";

export const metadata: Metadata = {
  title: "Библиотека — админка",
};

type FilterKey = "stage" | "direction" | "grade" | "outcome" | "companyType" | "status";
const STATUSES = ["draft", "published"] as const;
const STATUS_LABEL: Record<string, string> = { draft: "Черновик", published: "Опубликовано" };

interface AdminLibraryPageProps {
  searchParams: Promise<Partial<Record<FilterKey, string>>>;
}

function pick<T extends readonly string[]>(
  v: string | undefined,
  allowed: T,
): T[number] | undefined {
  return v && (allowed as readonly string[]).includes(v) ? (v as T[number]) : undefined;
}

function filterHref(
  params: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `/admin/library?${qs}` : "/admin/library";
}

function FilterRow({
  label,
  name,
  options,
  labels,
  active,
  params,
}: {
  label: string;
  name: FilterKey;
  options: readonly string[];
  labels: Record<string, string>;
  active: string | undefined;
  params: Record<string, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="text-text-3 w-24 shrink-0">{label}</span>
      {options.map((option) => {
        const isActive = active === option;
        return (
          <Link
            key={option}
            href={filterHref(params, { [name]: isActive ? undefined : option })}
            className={cn(
              "rounded-pill ease-app flex h-7 items-center border px-2.5 transition-colors duration-150",
              isActive
                ? "border-accent bg-accent/12 text-accent"
                : "border-border text-text-2 hover:border-border-strong hover:text-text-1",
            )}
          >
            {labels[option] ?? option}
          </Link>
        );
      })}
    </div>
  );
}

/** /admin/library (spec 8.5): таблица записей + форма с чеклист-гейтом. */
export default async function AdminLibraryPage({ searchParams }: AdminLibraryPageProps) {
  await requireAdminZone("mentor");
  const raw = await searchParams;
  const filters = {
    stage: pick(raw.stage, RECORDING_STAGES),
    direction: pick(raw.direction, RECORDING_DIRECTIONS),
    grade: pick(raw.grade, RECORDING_GRADES),
    outcome: pick(raw.outcome, RECORDING_OUTCOMES),
    companyType: pick(raw.companyType, COMPANY_TYPES),
    status: pick(raw.status, STATUSES),
  };
  const params = { ...filters } as Record<string, string | undefined>;

  const recordings = await listRecordingsAdmin(prisma, {
    stage: filters.stage as RecordingStage | undefined,
    direction: filters.direction as RecordingDirection | undefined,
    grade: filters.grade as RecordingGrade | undefined,
    outcome: filters.outcome as RecordingOutcome | undefined,
    companyType: filters.companyType as CompanyType | undefined,
    status: filters.status as ContentStatus | undefined,
  });
  const now = Date.now();
  const staleCount = recordings.filter((r) => isLinkStale(r.linkUpdatedAt, now)).length;
  const hasFilter = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold">Библиотека</h1>
          <p className="text-text-3 text-[13px]">
            Записи со ссылкой старше {LINK_STALE_DAYS} дней: {staleCount}
          </p>
        </div>
        <RecordingFormDialog />
      </div>

      <div className="rounded-card border-border bg-surface-1 flex flex-col gap-2 border p-4">
        <FilterRow
          label="Статус"
          name="status"
          options={STATUSES}
          labels={STATUS_LABEL}
          active={filters.status}
          params={params}
        />
        <FilterRow
          label="Этап"
          name="stage"
          options={RECORDING_STAGES}
          labels={RECORDING_STAGE_LABEL}
          active={filters.stage}
          params={params}
        />
        <FilterRow
          label="Направление"
          name="direction"
          options={RECORDING_DIRECTIONS}
          labels={RECORDING_DIRECTION_LABEL}
          active={filters.direction}
          params={params}
        />
        <FilterRow
          label="Грейд"
          name="grade"
          options={RECORDING_GRADES}
          labels={RECORDING_GRADE_LABEL}
          active={filters.grade}
          params={params}
        />
        <FilterRow
          label="Исход"
          name="outcome"
          options={RECORDING_OUTCOMES}
          labels={RECORDING_OUTCOME_LABEL}
          active={filters.outcome}
          params={params}
        />
        <FilterRow
          label="Тип компании"
          name="companyType"
          options={COMPANY_TYPES}
          labels={COMPANY_TYPE_LABEL}
          active={filters.companyType}
          params={params}
        />
        {hasFilter && (
          <div className="pt-1">
            <Link href="/admin/library" className="text-text-3 hover:text-text-1 text-[12px]">
              Сбросить фильтры
            </Link>
          </div>
        )}
      </div>

      {recordings.length === 0 ? (
        <Card>
          <EmptyState
            icon={Library}
            title={hasFilter ? "Ничего не нашлось" : "Записей пока нет"}
            description={
              hasFilter
                ? "Измени фильтры или сбрось их."
                : "Создай первую запись — метаданные, ссылка на Я.Диск и чеклист анонимизации."
            }
          />
        </Card>
      ) : (
        <div className="rounded-card border-border overflow-x-auto border">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="text-text-3 border-border border-b">
              <tr>
                <th className="p-3 font-medium">Запись</th>
                <th className="p-3 font-medium">Статус</th>
                <th className="p-3 font-medium">Чеклист</th>
                <th className="p-3 font-medium">Ссылка обновлена</th>
                <th className="p-3 font-medium">Просмотры</th>
                <th className="p-3 font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {recordings.map((recording) => {
                const complete = isChecklistComplete(recording.checklist);
                const stale = isLinkStale(recording.linkUpdatedAt, now);
                const formValue: RecordingFormValue = {
                  id: recording.id,
                  title: recording.title,
                  stage: recording.stage,
                  direction: recording.direction,
                  grade: recording.grade,
                  outcome: recording.outcome,
                  companyType: recording.companyType,
                  durationMinutes: recording.durationMinutes,
                  url: recording.url,
                  embedUrl: recording.embedUrl,
                  checklist:
                    (recording.checklist as unknown as RecordingFormValue["checklist"]) ?? {
                      faces: false,
                      voice: false,
                      names: false,
                      consent: false,
                    },
                };
                return (
                  <tr key={recording.id} className="border-border border-b align-top last:border-0">
                    <td className="p-3">
                      <div className="text-text-1 font-medium">{recording.title}</div>
                      <div className="text-text-3 text-[12px]">{recordingCardTitle(recording)}</div>
                    </td>
                    <td className="p-3">
                      {recording.status === "published" ? (
                        <Badge variant="success">опубликовано</Badge>
                      ) : (
                        <Badge>черновик</Badge>
                      )}
                    </td>
                    <td className="p-3">
                      {complete ? (
                        <Badge variant="success">4/4</Badge>
                      ) : (
                        <Badge variant="warning">
                          {
                            (["faces", "voice", "names", "consent"] as const).filter(
                              (k) => formValue.checklist[k],
                            ).length
                          }
                          /4
                        </Badge>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={cn(stale && "text-warning")}>
                        {formatDateRu(recording.linkUpdatedAt, "Europe/Moscow")}
                        {stale && " · устарела"}
                      </span>
                    </td>
                    <td className="p-3 tabular-nums">{recording._count.views}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <RecordingFormDialog recording={formValue} />
                        <RecordingStatusButton
                          id={recording.id}
                          status={recording.status}
                          canPublish={complete}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
