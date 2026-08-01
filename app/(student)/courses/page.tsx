import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import {
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  Braces,
  CheckCircle2,
  Cpu,
  Database,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { listCoursesForStudent } from "@/lib/services/content";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import { IconTile } from "@/components/features/icon-tile";
import { LockedCourseCard, LockedNotice } from "@/components/features/locked-course";
import { pluralRu } from "@/lib/utils/dates";

export const metadata: Metadata = {
  title: "Обучение",
};

const GATING_LABEL = {
  strict: "строгий порядок",
  recommended: "рекомендованный порядок",
  free: "свободный порядок",
} as const;

const TRACK_LABEL: Record<string, string> = {
  ds: "Data Science",
  nlp: "NLP",
  ai: "AI Engineering",
};

// Курсы не несут поля цвета/иконки — берём категорийный цвет + иконку по индексу.
const COURSE_ICONS: LucideIcon[] = [BarChart3, Bot, Blocks, Braces, Database, Cpu];

/** Course catalog (spec 8.3, design «Обучение»): track-ordered cards with progress. */
export default async function CoursesPage() {
  const { user } = await requireStudentZone();
  const courses = await listCoursesForStudent(prisma, user.id);

  const trackLabel = user.track ? TRACK_LABEL[user.track] : null;
  const subtitle =
    courses.length > 0
      ? `${trackLabel ? `Твой трек: ${trackLabel} · ` : ""}${courses.length} ${pluralRu(
          courses.length,
          "курс",
          "курса",
          "курсов",
        )}`
      : undefined;

  return (
    <div className="flex flex-col gap-5">
      {/* Toast after a direct-URL hit on a locked course (block 2v2.3). */}
      <Suspense fallback={null}>
        <LockedNotice />
      </Suspense>
      <PageHeader title="Обучение" subtitle={subtitle} />

      {courses.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            title="Курсы готовятся"
            description="Скоро здесь появится программа обучения."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course, index) => {
            const catVar = `var(--cat-${index % 8})`;
            const Icon = COURSE_ICONS[index % COURSE_ICONS.length]!;
            const card = (
              <Card
                catHover={course.locked ? undefined : catVar}
                className={cn(
                  "h-full",
                  // Recommended next step (changelog 13.6) — a hint, not a gate.
                  course.isNext && "border-accent/40 bg-accent/[0.03]",
                  // Block 2v2.3: locked courses stay visible, just visibly shut.
                  course.locked && "bg-surface-2/40",
                )}
              >
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-center gap-3">
                    <IconTile
                      icon={course.locked ? Lock : Icon}
                      colorVar={course.locked ? "var(--text-3)" : catVar}
                    />
                    <h2
                      className={cn(
                        "min-w-0 flex-1 text-[16px] leading-tight font-semibold tracking-[-0.01em]",
                        course.locked && "text-text-2",
                      )}
                    >
                      {course.title}
                    </h2>
                    {course.isCompleted && (
                      <CheckCircle2
                        size={18}
                        strokeWidth={1.75}
                        className="text-success shrink-0"
                        aria-label="Курс пройден"
                      />
                    )}
                  </div>
                  {course.description && (
                    <p
                      className={cn(
                        "line-clamp-2 text-[13px]",
                        course.locked ? "text-text-3" : "text-text-2",
                      )}
                    >
                      {course.description}
                    </p>
                  )}
                  <div className="mt-auto flex flex-col gap-2">
                    {course.locked ? (
                      <p className="text-text-3 flex items-center gap-1.5 text-[12px]">
                        <Lock
                          size={13}
                          strokeWidth={1.75}
                          className="shrink-0"
                          aria-hidden="true"
                        />
                        {course.unlocksAfter
                          ? `Откроется после курса «${course.unlocksAfter}»`
                          : "Откроется позже"}
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          {course.isNext ? (
                            <Badge variant="accent">Начни отсюда</Badge>
                          ) : (
                            <Badge>{GATING_LABEL[course.gating]}</Badge>
                          )}
                          <span className="text-text-3 shrink-0 text-[12px]">
                            {course.lessonsCompleted} из {course.lessonsTotal}{" "}
                            {pluralRu(course.lessonsTotal, "урока", "уроков", "уроков")}
                          </span>
                        </div>
                        <ProgressBar
                          value={course.progressPct}
                          gradient
                          aria-label={`Прогресс курса: ${course.progressPct}%`}
                        />
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );

            return course.locked ? (
              <LockedCourseCard
                key={course.id}
                title={course.title}
                unlocksAfter={course.unlocksAfter}
              >
                {card}
              </LockedCourseCard>
            ) : (
              <Link
                key={course.id}
                href={`/courses/${course.slug}`}
                className="group block min-w-0"
              >
                {card}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
