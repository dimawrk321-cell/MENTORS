import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  CompanyType,
  RecordingDirection,
  RecordingGrade,
  RecordingOutcome,
  RecordingStage,
} from "@prisma/client";
import { Library } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { listRecordingsCatalog } from "@/lib/services/library";
import {
  COMPANY_TYPES,
  COMPANY_TYPE_LABEL,
  RECORDING_DIRECTIONS,
  RECORDING_DIRECTION_LABEL,
  RECORDING_GRADES,
  RECORDING_GRADE_LABEL,
  RECORDING_OUTCOMES,
  RECORDING_OUTCOME_LABEL,
  RECORDING_STAGES,
  RECORDING_STAGE_LABEL,
} from "@/lib/constants";
import { RecordingCard } from "@/components/features/recording-card";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Библиотека",
};

type Filters = "stage" | "direction" | "grade" | "outcome" | "companyType";

interface LibraryPageProps {
  searchParams: Promise<Partial<Record<Filters, string>>>;
}

function pickValue<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
): T[number] | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

function filterHref(
  params: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...patch })) {
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `/library?${qs}` : "/library";
}

interface FilterRowProps {
  label: string;
  name: Filters;
  options: readonly string[];
  labels: Record<string, string>;
  active: string | undefined;
  params: Record<string, string | undefined>;
}

function FilterRow({ label, name, options, labels, active, params }: FilterRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
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

/** Каталог библиотеки записей (spec 7.9). Виден только при library_enabled. */
export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const { user } = await requireStudentZone();
  // Пер-ученический тумблер (spec 7.9): раздел и его роуты скрыты при выключении.
  if (!user.libraryEnabled) notFound();

  const raw = await searchParams;
  const filters = {
    stage: pickValue<typeof RECORDING_STAGES>(raw.stage, RECORDING_STAGES),
    direction: pickValue<typeof RECORDING_DIRECTIONS>(raw.direction, RECORDING_DIRECTIONS),
    grade: pickValue<typeof RECORDING_GRADES>(raw.grade, RECORDING_GRADES),
    outcome: pickValue<typeof RECORDING_OUTCOMES>(raw.outcome, RECORDING_OUTCOMES),
    companyType: pickValue<typeof COMPANY_TYPES>(raw.companyType, COMPANY_TYPES),
  };
  const recordings = await listRecordingsCatalog(prisma, {
    stage: filters.stage as RecordingStage | undefined,
    direction: filters.direction as RecordingDirection | undefined,
    grade: filters.grade as RecordingGrade | undefined,
    outcome: filters.outcome as RecordingOutcome | undefined,
    companyType: filters.companyType as CompanyType | undefined,
  });
  const hasFilter = Object.values(filters).some(Boolean);
  const params = { ...filters } as Record<string, string | undefined>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[24px] font-semibold">Библиотека</h1>
        <p className="text-text-2 mt-1 text-[14px]">
          Анонимизированные записи реальных собеседований — по этапам, направлениям и грейдам.
        </p>
      </div>

      <div className="rounded-card border-border bg-surface-1 flex flex-col gap-2 border p-4">
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
            <Link href="/library" className="text-text-3 hover:text-text-1 text-[13px]">
              Сбросить фильтры
            </Link>
          </div>
        )}
      </div>

      {recordings.length === 0 ? (
        <Card>
          <EmptyState
            icon={Library}
            title={hasFilter ? "Ничего не нашлось" : "Записи скоро появятся"}
            description={
              hasFilter
                ? "Попробуй ослабить фильтры — по этому набору записей пока нет."
                : "Команда загружает анонимизированные собеседования. Загляни позже."
            }
            action={
              hasFilter ? (
                <Link href="/library" className="text-accent text-[14px]">
                  Сбросить фильтры
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {recordings.map((recording) => (
            <RecordingCard key={recording.id} recording={recording} />
          ))}
        </div>
      )}
    </div>
  );
}
