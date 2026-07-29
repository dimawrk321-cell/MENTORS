import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  Braces,
  Cpu,
  Database,
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
import { IconTile } from "@/components/features/icon-tile";
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
  const courses = await listCoursesForStudent(prisma, user.id, user.track);

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
            return (
              <Link
                key={course.id}
                href={`/courses/${course.slug}`}
                className="group block min-w-0"
              >
                <Card interactive className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <div className="flex items-center gap-3">
                      <IconTile icon={Icon} colorVar={catVar} />
                      <h2 className="min-w-0 text-[16px] leading-tight font-semibold tracking-[-0.01em]">
                        {course.title}
                      </h2>
                    </div>
                    {course.description && (
                      <p className="text-text-2 line-clamp-2 text-[13px]">{course.description}</p>
                    )}
                    <div className="mt-auto flex flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <Badge>{GATING_LABEL[course.gating]}</Badge>
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
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
