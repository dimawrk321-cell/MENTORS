import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, Lock } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getLessonView } from "@/lib/services/content";
import { canOpenCourse } from "@/lib/services/course-access";
import { getMockBookingAccess } from "@/lib/services/mock-access";
import {
  getInlineQuestionsForLesson,
  getKeyQuestionsForLesson,
  getQuizQuestionsForLesson,
} from "@/lib/services/questions";
import { KeyQuestions } from "@/components/features/key-questions";
import { QuizWidget } from "@/components/features/quiz/quiz-widget";
import { InlineQuestion } from "@/components/features/quiz/inline-question";
import { InlineQuestionUnavailable } from "@/components/blocks/inline-question-slot";
import { renderLessonContent } from "@/components/blocks/lesson-renderer";
import { Watermark } from "@/components/features/watermark";
import { LessonReader } from "@/components/features/lesson-reader";
import { LessonTocRail, LessonTocSheet } from "@/components/features/lesson-toc";
import { CompleteLessonButton } from "@/components/features/complete-lesson-button";
import { CompleteLessonStepButton } from "@/components/features/lesson-step-navigation";
import { ReportDialog } from "@/components/features/report-dialog";
import { ReadingSizeControl } from "@/components/features/reading-size-control";
import { ReadingTracker } from "@/components/features/reading-tracker";
import { ReadingChapterHeader } from "@/components/features/reading-chapter-header";
import { ReadingNavCards, type ReadingNavItem } from "@/components/features/reading-nav-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProgressSegment } from "@/components/ui/progress-bar";
import { lessonDurationLabel } from "@/lib/utils/lesson-path";
import { resolveAccessibleLessonStep } from "@/lib/utils/lesson-step-access";
import { lessonStepMarkdownForDisplay } from "@/lib/utils/lesson-step-content";
import { isPlayableVideoUrl } from "@/lib/utils/youtube";

const DIFFICULTY_LABEL = { intro: "интро", base: "база", advanced: "продвинутый" } as const;

interface LessonPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ step?: string }>;
}

export async function generateMetadata({ params }: LessonPageProps): Promise<Metadata> {
  const { id } = await params;
  const lesson = await prisma.lesson.findUnique({ where: { id }, select: { title: true } });
  return { title: lesson?.title ?? "Урок" };
}

/** Lesson page — full anatomy per spec 7.3; quiz and key questions join at stage 3. */
export default async function LessonPage({ params, searchParams }: LessonPageProps) {
  const { user, session, impersonated } = await requireStudentZone();
  const { id } = await params;
  const view = await getLessonView(prisma, id, user.id);
  if (!view) notFound();

  // Block 2v2.3: the course chain gates the whole course, so its lessons are not
  // reachable by URL either. In-course gating below is unchanged.
  if (!(await canOpenCourse(prisma, user.id, view.course.id))) {
    redirect(`/courses?locked=${encodeURIComponent(view.course.title)}`);
  }

  // Locked lesson (strict gating) → «Урок откроется после …» (spec 8.3).
  if (!view.unlocked) {
    return (
      <Card className="mx-auto max-w-xl">
        <EmptyState
          icon={Lock}
          title="Урок пока закрыт"
          description={
            view.unlockReason?.kind === "lesson"
              ? `Откроется после урока «${view.unlockReason.title}».`
              : view.unlockReason?.kind === "module_test"
                ? `Откроется после модульного теста «${view.unlockReason.moduleTitle}».`
                : "Заверши предыдущие шаги курса, чтобы открыть его."
          }
          action={
            view.unlockReason?.kind === "lesson" ? (
              <Button asChild>
                <Link href={`/lessons/${view.unlockReason.id}`}>Перейти к нужному шагу</Link>
              </Button>
            ) : view.unlockReason?.kind === "module_test" ? (
              <Button asChild>
                <Link href={`/tests/${view.unlockReason.moduleId}`}>К тесту модуля</Link>
              </Button>
            ) : (
              <Button asChild variant="secondary">
                <Link href={`/courses/${view.course.slug}`}>К курсу</Link>
              </Button>
            )
          }
        />
      </Card>
    );
  }

  const { step: requestedStepId } = (await searchParams) ?? {};
  const hasMultipleSteps = view.lessonSteps.length > 1;
  const activeStep = resolveAccessibleLessonStep(view.lessonSteps, requestedStepId);
  // Keep the active step stable after router.refresh() and prevent a direct URL
  // from opening a future step before its predecessors are completed.
  if (hasMultipleSteps && activeStep && requestedStepId !== activeStep.id) {
    redirect(`/lessons/${view.lesson.id}?step=${encodeURIComponent(activeStep.id)}`);
  }
  const activeStepIndex = activeStep
    ? view.lessonSteps.findIndex((step) => step.id === activeStep.id)
    : -1;
  const isFinalStep = activeStepIndex === view.lessonSteps.length - 1;
  const markdown = activeStep
    ? lessonStepMarkdownForDisplay(activeStep.contentMd)
    : view.lesson.contentMd;
  const outlineSteps = view.lessonSteps.map((step) => ({
    id: step.id,
    title: step.title,
    completed: step.completedAt !== null,
    unlocked: step.unlocked,
  }));

  // Заход B.1: вопросы, вставленные в текст директивами, грузятся ОДНИМ
  // запросом до рендера — путь рендера остаётся без обращений к БД.
  const inlineQuestions = await getInlineQuestionsForLesson(prisma, markdown);
  // Блок 3.4: CTA внутри `:::mock` подчиняется правилу «бронь после первого
  // курса». Считаем доступ только для уроков, где директива есть, — прогресс по
  // всем курсам ради урока без мока читать незачем.
  const mockAccess = markdown.includes(":::mock")
    ? await getMockBookingAccess(prisma, user.id)
    : null;
  const { content, headings } = await renderLessonContent(markdown, {
    mockLocked:
      mockAccess && !mockAccess.open
        ? { unlockingCourseTitle: mockAccess.unlockingCourse?.title ?? null }
        : null,
    inlineQuestion: (questionId) => {
      const entry = inlineQuestions.get(questionId);
      if (!entry?.question) {
        return <InlineQuestionUnavailable reason={entry?.problem ?? "no_id"} />;
      }
      return (
        <InlineQuestion question={entry.question} lessonId={view.lesson.id} userId={user.id} />
      );
    },
  });
  const durationLabel = lessonDurationLabel({
    // Duration metadata belongs to the whole lesson. The active step already
    // has its own progress marker; using its reading time here made the same
    // lesson promise a different total on every step (заход C.12).
    readingMinutes: view.lesson.readingMinutes,
    textMinutes: view.lesson.textMinutes,
    videoMinutes: view.lesson.videoMinutes,
    practiceMinutes: view.lesson.practiceMinutes,
    pathPolicy: view.lesson.pathPolicy,
    hasVideo: Boolean(view.lesson.videoUrl),
    // Заход C.4: ссылка, которую плеер не встраивает, не даёт пути «вместо
    // текста» — подпись обещает ровно то, что ученик увидит на странице.
    videoPlayable: isPlayableVideoUrl(view.lesson.videoUrl),
  });
  const [keyQuestions, quizQuestions] = await Promise.all([
    getKeyQuestionsForLesson(
      prisma,
      view.lesson.id,
      activeStep ? { stepId: activeStep.id, includeLessonLevel: isFinalStep } : undefined,
    ),
    getQuizQuestionsForLesson(prisma, {
      lessonId: view.lesson.id,
      userId: user.id,
      contentMd: markdown,
      ...(activeStep ? { stepId: activeStep.id, includeLessonLevel: isFinalStep } : {}),
    }),
  ]);

  // Сегменты шапки «Урок X из Y» — уже посчитанное состояние гейтинга модуля.
  const segments: ProgressSegment[] = view.position.steps.map((step) =>
    step.current ? "current" : step.completed ? "done" : step.unlocked ? "todo" : "locked",
  );
  const stepSegments: ProgressSegment[] = view.lessonSteps.map((step) =>
    step.id === activeStep?.id
      ? "current"
      : step.completedAt !== null
        ? "done"
        : step.unlocked
          ? "todo"
          : "locked",
  );

  // В составном уроке нижние карточки ведут по шагам. Только на границах
  // возвращаем соседний урок — так ученик не перескакивает через материал.
  const previousStep = activeStepIndex > 0 ? view.lessonSteps[activeStepIndex - 1] : null;
  const nextStep = activeStepIndex >= 0 ? view.lessonSteps[activeStepIndex + 1] : null;
  const prevNav: ReadingNavItem | null = previousStep
    ? {
        href: `/lessons/${view.lesson.id}?step=${previousStep.id}`,
        title: previousStep.title,
        kicker: "Предыдущий шаг",
      }
    : view.prev && view.prev.unlocked
      ? { href: `/lessons/${view.prev.id}`, title: view.prev.title, kicker: "Предыдущий урок" }
      : null;
  const nextNav: ReadingNavItem | null = nextStep?.unlocked
    ? {
        href: `/lessons/${view.lesson.id}?step=${nextStep.id}`,
        title: nextStep.title,
        kicker: "Следующий шаг",
      }
    : !nextStep && activeStep?.completedAt !== null && view.next
      ? {
          href: `/lessons/${view.next.id}`,
          title: view.next.title,
          kicker: "Следующий урок",
          locked: !view.next.unlocked,
          lockHint: view.next.unlocked ? undefined : "Откроется после предыдущих шагов курса",
        }
      : null;

  return (
    <ReadingTracker headingIds={headings.map((heading) => heading.id)}>
      <div className="flex gap-10">
        {/* break-words covers everything OUTSIDE .lesson-prose (title, breadcrumbs,
          chips, key questions, quiz) — a long unbreakable title burst the page at
          390px (changelog 13.6). Inside the article the stricter
          `overflow-wrap: anywhere` rule still wins. */}
        {/* data-reading-size lives on the whole reading COLUMN, not just the
          article: the key questions and the quiz are prose too (audit 13.6). */}
        <div
          className="mx-auto w-full max-w-[680px] min-w-0 break-words"
          data-reading-size={user.readingFontSize}
        >
          {/* Header: breadcrumbs, title, chips (spec 7.3) */}
          <nav
            aria-label="Хлебные крошки"
            className="text-text-3 mb-3 flex flex-wrap items-center gap-1 text-[13px]"
          >
            <Link
              href="/courses"
              className="ease-app hover:text-text-1 transition-colors duration-150"
            >
              Обучение
            </Link>
            <ChevronRight size={13} strokeWidth={1.75} aria-hidden="true" />
            <Link
              href={`/courses/${view.course.slug}`}
              className="ease-app hover:text-text-1 transition-colors duration-150"
            >
              {view.course.title}
            </Link>
            <ChevronRight size={13} strokeWidth={1.75} aria-hidden="true" />
            <span>{view.module.title}</span>
          </nav>

          {/* «Урок X из Y» + сегментированный индикатор модуля («Читалка v2»). */}
          <ReadingChapterHeader
            kicker="Урок"
            index={view.position.index}
            total={view.position.total}
            segments={segments}
            currentSegments={hasMultipleSteps ? stepSegments : undefined}
          />

          <h1 className="text-[32px] leading-[1.2] font-semibold tracking-[-0.02em]">
            {view.lesson.title}
          </h1>
          {hasMultipleSteps && activeStep && (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-accent text-[11px] font-semibold tracking-[0.08em] uppercase">
                Шаг {activeStepIndex + 1} из {view.lessonSteps.length}
              </span>
              <span className="text-text-2 text-base font-medium">{activeStep.title}</span>
            </p>
          )}
          <div className="mt-2.5 mb-5 flex flex-wrap items-center gap-2">
            <Badge>{durationLabel}</Badge>
            <Badge>{DIFFICULTY_LABEL[view.lesson.difficulty]}</Badge>
            {view.lesson.isOptional && <Badge>необязательный</Badge>}
            {view.state.updatedSinceCompletion && <Badge variant="accent">обновлён</Badge>}
            <div className="ml-auto flex items-center gap-2">
              <ReadingSizeControl initial={user.readingFontSize} />
              <LessonTocSheet
                headings={headings}
                title={hasMultipleSteps ? "В этом шаге" : "В этом уроке"}
                lessonId={view.lesson.id}
                steps={outlineSteps}
                activeStepId={activeStep?.id}
              />
            </div>
          </div>

          <LessonReader
            lessonId={view.lesson.id}
            stepId={activeStep?.id ?? null}
            initialScrollPos={activeStep?.scrollPos ?? view.progress.scrollPos}
            initialVideoPos={view.progress.videoPos}
            completed={view.progress.completedAt !== null}
            impersonated={impersonated}
            pathPolicy={view.lesson.pathPolicy}
            initialSelectedPath={view.progress.selectedPath}
            hasText={Boolean(markdown.trim())}
            video={
              view.lesson.videoUrl
                ? {
                    url: view.lesson.videoUrl,
                    status: view.lesson.videoStatus,
                    title: view.lesson.title,
                  }
                : null
            }
          >
            {/* Reading column with the always-present watermark layer (spec 5.7). */}
            <div className="relative">
              <Watermark email={session.user.email} />
              <article className="lesson-prose reading-article">{content}</article>
            </div>
          </LessonReader>

          {/* Автоблок ключевых вопросов + квиз (spec 7.3/7.5) */}
          <KeyQuestions questions={keyQuestions} />
          <QuizWidget lessonId={view.lesson.id} userId={user.id} questions={quizQuestions} />

          {/* Completion + prev/next (spec 7.3) */}
          <div className="border-border mt-10 flex flex-col gap-5 border-t pt-6">
            <div className="flex justify-center">
              {hasMultipleSteps && activeStep ? (
                <CompleteLessonStepButton
                  key={activeStep.id}
                  lessonId={view.lesson.id}
                  stepId={activeStep.id}
                  nextStepId={view.lessonSteps[activeStepIndex + 1]?.id ?? null}
                  completed={activeStep.completedAt !== null}
                />
              ) : (
                <CompleteLessonButton
                  lessonId={view.lesson.id}
                  completed={view.progress.completedAt !== null}
                />
              )}
            </div>
            <ReadingNavCards prev={prevNav} next={nextNav} />
          </div>
        </div>

        <LessonTocRail
          headings={headings}
          title={hasMultipleSteps ? "В этом шаге" : "В этом уроке"}
          lessonId={view.lesson.id}
          steps={outlineSteps}
          activeStepId={activeStep?.id}
          reserveReportActionSpace
        />
      </div>
      <ReportDialog lessonId={view.lesson.id} />
    </ReadingTracker>
  );
}
