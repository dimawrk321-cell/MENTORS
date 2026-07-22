import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getCourseView } from "@/lib/services/content";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleTree, type ModuleTreeModule } from "@/components/features/module-tree";
import { ModuleAccordion, CourseStickyCta } from "@/components/features/module-accordion";
import { Linkify } from "@/components/blocks/linkify";

const GATING_LABEL = {
  strict: "строгий порядок",
  recommended: "рекомендованный порядок",
  free: "свободный порядок",
} as const;

interface CoursePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CoursePageProps): Promise<Metadata> {
  const { slug } = await params;
  const course = await prisma.course.findUnique({ where: { slug }, select: { title: true } });
  return { title: course?.title ?? "Курс" };
}

/** Course page (spec 8.3): header + ModuleTree; test rows/test-out join at stage 3. */
export default async function CoursePage({ params }: CoursePageProps) {
  const { user } = await requireStudentZone();
  const { slug } = await params;
  const view = await getCourseView(prisma, slug, user.id);
  if (!view) notFound();

  const { course, state } = view;
  const progressPct =
    state.totalRequired === 0
      ? 0
      : Math.round((state.completedRequired / state.totalRequired) * 100);

  const treeModules: ModuleTreeModule[] = course.modules.map((module) => {
    const moduleState = state.modules.get(module.id)!;
    const testState = view.testStates.get(module.id);
    const lessonsDone = moduleState.completedRequired === moduleState.totalRequired;
    return {
      id: module.id,
      title: module.title,
      completedRequired: moduleState.completedRequired,
      totalRequired: moduleState.totalRequired,
      test: testState?.test.enabled
        ? {
            passed: testState.passed,
            bestScore: testState.bestPassedScore,
            available: lessonsDone,
            // Spec 7.3: экстерн — на незачтённых strict-модулях с непройденными уроками.
            testoutAvailable: course.gating === "strict" && !testState.passed && !lessonsDone,
          }
        : undefined,
      lessons: module.lessons.map((lesson) => {
        const lessonState = state.lessons.get(lesson.id)!;
        return {
          id: lesson.id,
          title: lesson.title,
          readingMinutes: lesson.readingMinutes,
          isOptional: lesson.isOptional,
          unlocked: lessonState.unlocked,
          completed: lessonState.completed,
          current: lessonState.current,
          updatedSinceCompletion: lessonState.updatedSinceCompletion,
        };
      }),
    };
  });

  // The mobile sticky CTA targets the current (next open, incomplete) lesson.
  const currentLesson = treeModules.flatMap((m) => m.lessons).find((l) => l.current) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/courses"
          className="text-text-3 ease-app hover:text-text-1 mb-3 flex w-fit items-center gap-1.5 text-[13px] transition-colors duration-150"
        >
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          Обучение
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[24px] font-semibold">{course.title}</h1>
          <Badge>{GATING_LABEL[course.gating]}</Badge>
        </div>
        {course.description && (
          <p className="text-text-2 mt-1.5 max-w-[64ch] text-[14px]">
            <Linkify text={course.description} />
          </p>
        )}
        <div className="mt-4 flex max-w-sm items-center gap-3">
          <ProgressBar value={progressPct} aria-label={`Прогресс курса: ${progressPct}%`} />
          <span className="text-text-3 shrink-0 text-[12px] tabular-nums">{progressPct}%</span>
        </div>
      </div>

      {treeModules.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="Уроки готовятся"
            description="Материалы курса скоро появятся."
          />
        </Card>
      ) : (
        <>
          {/* Desktop: unchanged ModuleTree. Mobile (<768px): accordion + sticky CTA. */}
          <Card className="hidden md:block">
            <CardContent className="p-5">
              <ModuleTree modules={treeModules} />
            </CardContent>
          </Card>
          <div className="md:hidden">
            <ModuleAccordion modules={treeModules} />
            {/* Clearance so the last row is not hidden behind the fixed CTA + nav. */}
            {currentLesson && <div aria-hidden="true" className="h-16" />}
          </div>
          {currentLesson && (
            <CourseStickyCta lessonId={currentLesson.id} lessonTitle={currentLesson.title} />
          )}
        </>
      )}
    </div>
  );
}
