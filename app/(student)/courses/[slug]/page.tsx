import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Clock, FileText, ListOrdered } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getCourseView } from "@/lib/services/content";
import { canOpenCourse } from "@/lib/services/course-access";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { type ModuleTreeModule } from "@/components/features/module-tree";
import { CourseStickyCta } from "@/components/features/module-accordion";
import { CourseProgram } from "@/components/features/course-program";
import { CourseProgressCard } from "@/components/features/course-progress-card";
import { CourseSideRail } from "@/components/features/course-side-rail";
import { lessonTotalMinutes } from "@/lib/utils/lesson-path";
import { Linkify } from "@/components/blocks/linkify";
import { BackButton } from "@/components/ui/back-button";

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

  // Block 2v2.3: a locked course is not reachable by URL either — back to the
  // catalog with a toast (notFound would lie: the course exists, it is shut).
  if (!(await canOpenCourse(prisma, user.id, view.course.id))) {
    redirect(`/courses?locked=${encodeURIComponent(view.course.title)}`);
  }

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
          pathPolicy: lesson.pathPolicy,
          textMinutes: lesson.textMinutes,
          videoMinutes: lesson.videoMinutes,
          practiceMinutes: lesson.practiceMinutes,
          hasVideo: Boolean(lesson.videoUrl),
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
  const allLessons = treeModules.flatMap((m) => m.lessons);
  const currentLesson = allLessons.find((l) => l.current) ?? null;

  // Оценки времени (заход B.5). «Всего» — по всем урокам курса, «осталось» — по
  // незавершённым ОБЯЗАТЕЛЬНЫМ: необязательный урок ничего не гейтит, и включать
  // его в долг ученика нечестно. Видео с неизвестной длительностью в сумму не
  // входит — поэтому на экране «~», а не точное число (lessonTotalMinutes).
  const totalMinutes = allLessons.reduce((sum, lesson) => sum + lessonTotalMinutes(lesson), 0);
  const remainingMinutes = allLessons
    .filter((lesson) => !lesson.completed && !lesson.isOptional)
    .reduce((sum, lesson) => sum + lessonTotalMinutes(lesson), 0);
  const courseDone = state.totalRequired > 0 && state.completedRequired === state.totalRequired;

  return (
    /* Ширину держит контейнер зоны (max-w-6xl, решение 13.1/B4) — второй потолок
       из референса (1180px) здесь только спорил бы с ним.
       `@container` объявлен ЗДЕСЬ, а не на строке с программой: элемент не может
       спрашивать сам себя — контейнерный запрос действует только на потомков,
       и `@min-[840px]:flex-row` на самом контейнере не сработал бы (проверено
       замером: колонка оставалась под программой при контенте 961px). */
    <div className="@container flex flex-col gap-6">
      <div>
        {/* D4 (spec 13.1): hierarchical back, unified onto BackButton (44px touch target).
            В референсе это «хлебные крошки» той же роли — кнопка возврата в «Обучение». */}
        <BackButton href="/courses" label="Обучение" className="mb-3" />
        {/* Чипы курса: порядок прохождения и оценка объёма. «Вводный курс» из
            референса не рисуем — такого признака в модели нет (см. отчёт B.5). */}
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <span className="rounded-pill border-border text-text-3 inline-flex items-center gap-1.5 border px-2.5 py-[3px] text-[11px]">
            <ListOrdered size={12} strokeWidth={1.75} aria-hidden="true" />
            {GATING_LABEL[course.gating]}
          </span>
          {totalMinutes > 0 && (
            <span className="rounded-pill border-border text-text-3 inline-flex items-center gap-1.5 border px-2.5 py-[3px] text-[11px]">
              <Clock size={12} strokeWidth={1.75} aria-hidden="true" />
              {totalMinutes} мин всего
            </span>
          )}
        </div>
        <h1 className="text-[clamp(1.75rem,6.5vw,2.5rem)] leading-[1.12] font-bold tracking-[-0.025em] text-balance">
          {course.title}
        </h1>
        {course.description && (
          /* Заход B.4: переносы строк описания видны ученику. Текст хранится в
             courses.description как есть, а обычный <p> схлопывал переводы строк
             в пробел — многострочное описание из студии читалось одним куском.
             Карточка каталога остаётся без pre-line: там текст обрезан двумя
             строками, и ранний перенос съел бы половину видимого. */
          <p className="text-text-2 mt-3 max-w-[62ch] text-[17px] leading-relaxed whitespace-pre-line">
            <Linkify text={course.description} />
          </p>
        )}
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
          <CourseProgressCard
            percent={progressPct}
            completed={state.completedRequired}
            total={state.totalRequired}
            remainingMinutes={courseDone ? null : remainingMinutes}
            cta={
              currentLesson
                ? {
                    href: `/lessons/${currentLesson.id}`,
                    label: `Продолжить: ${currentLesson.title}`,
                  }
                : null
            }
          />

          {/* Программа и правая колонка.
              Порог — КОНТЕЙНЕРНЫЙ, а не по вьюпорту: референс прячет колонку
              ниже 1060px, но он рисован без боковой панели, а у нас на тех же
              1060px контенту достаётся 741px — колонка всё равно не встала бы
              рядом. Плюс ширина контента зависит от состояния панели (240px,
              рельс 64px или свёрнута выбором ученика, заход B.3), то есть одна
              и та же ширина окна даёт разное место. Считаем по факту: 520
              (программа) + 32 (зазор) + 280 (колонка) = 832, отсюда 840. */}
          <div className="flex flex-col gap-[clamp(1.25rem,3vw,2rem)] @min-[840px]:flex-row @min-[840px]:items-start">
            <div className="min-w-0 flex-1">
              <CourseProgram modules={treeModules} />
              {/* Clearance so the last row is not hidden behind the fixed CTA + nav. */}
              {currentLesson && <div aria-hidden="true" className="h-16 md:hidden" />}
            </div>
            <aside
              aria-label="О курсе"
              className="flex min-w-0 flex-col gap-3 @min-[840px]:sticky @min-[840px]:top-16 @min-[840px]:w-[280px] @min-[840px]:flex-none"
            >
              <CourseSideRail />
            </aside>
          </div>

          {currentLesson && (
            <CourseStickyCta lessonId={currentLesson.id} lessonTitle={currentLesson.title} />
          )}
        </>
      )}
    </div>
  );
}
