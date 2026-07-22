import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { listCoursesForStudent } from "@/lib/services/content";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { pluralRu } from "@/lib/utils/dates";

export const metadata: Metadata = {
  title: "Обучение",
};

const GATING_LABEL = {
  strict: "строгий порядок",
  recommended: "рекомендованный порядок",
  free: "свободный порядок",
} as const;

/** Course catalog (spec 8.3): track-ordered cards with progress and gating mark. */
export default async function CoursesPage() {
  const { user } = await requireStudentZone();
  const courses = await listCoursesForStudent(prisma, user.id, user.track);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[24px] font-semibold">Обучение</h1>

      {courses.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            title="Курсы готовятся"
            description="Скоро здесь появится программа обучения."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <Link key={course.id} href={`/courses/${course.slug}`} className="group">
              <Card interactive className="h-full">
                <CardContent className="flex h-full flex-col gap-3">
                  <div>
                    <h2 className="group-hover:text-accent text-[16px] font-semibold">
                      {course.title}
                    </h2>
                    {course.description && (
                      <p className="text-text-2 mt-1 line-clamp-2 text-[13px]">
                        {course.description}
                      </p>
                    )}
                  </div>
                  <div className="mt-auto flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <Badge>{GATING_LABEL[course.gating]}</Badge>
                      <span className="text-text-3 text-[12px]">
                        {course.lessonsCompleted} из {course.lessonsTotal}{" "}
                        {pluralRu(course.lessonsTotal, "урока", "уроков", "уроков")}
                      </span>
                    </div>
                    <ProgressBar
                      value={course.progressPct}
                      aria-label={`Прогресс курса: ${course.progressPct}%`}
                    />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
