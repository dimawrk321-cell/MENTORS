import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, Lock } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getLessonView } from "@/lib/services/content";
import { canOpenCourse } from "@/lib/services/course-access";
import { getKeyQuestionsForLesson, getQuizQuestionsForLesson } from "@/lib/services/questions";
import { KeyQuestions } from "@/components/features/key-questions";
import { QuizWidget } from "@/components/features/quiz/quiz-widget";
import { renderLessonContent } from "@/components/blocks/lesson-renderer";
import { Watermark } from "@/components/features/watermark";
import { LessonReader } from "@/components/features/lesson-reader";
import { LessonTocRail, LessonTocSheet } from "@/components/features/lesson-toc";
import { CompleteLessonButton } from "@/components/features/complete-lesson-button";
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

const DIFFICULTY_LABEL = { intro: "интро", base: "база", advanced: "продвинутый" } as const;

interface LessonPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: LessonPageProps): Promise<Metadata> {
  const { id } = await params;
  const lesson = await prisma.lesson.findUnique({ where: { id }, select: { title: true } });
  return { title: lesson?.title ?? "Урок" };
}

/** Lesson page — full anatomy per spec 7.3; quiz and key questions join at stage 3. */
export default async function LessonPage({ params }: LessonPageProps) {
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

  const { content, headings } = await renderLessonContent(view.lesson.contentMd);
  const durationLabel = lessonDurationLabel({
    readingMinutes: view.lesson.readingMinutes,
    textMinutes: view.lesson.textMinutes,
    videoMinutes: view.lesson.videoMinutes,
    practiceMinutes: view.lesson.practiceMinutes,
    pathPolicy: view.lesson.pathPolicy,
    hasVideo: Boolean(view.lesson.videoUrl),
  });
  const [keyQuestions, quizQuestions] = await Promise.all([
    getKeyQuestionsForLesson(prisma, view.lesson.id),
    getQuizQuestionsForLesson(prisma, { lessonId: view.lesson.id, userId: user.id }),
  ]);

  // Сегменты шапки «Урок X из Y» — уже посчитанное состояние гейтинга модуля.
  const segments: ProgressSegment[] = view.position.steps.map((step) =>
    step.current ? "current" : step.completed ? "done" : step.unlocked ? "todo" : "locked",
  );

  // Карточки «Предыдущий/Следующий урок». Доступность решена на сервере: цепь
  // курсов уже пропустила нас сюда (redirect выше), внутрикурсовой гейтинг —
  // в `unlocked`. Закрытый следующий урок рендерится замком и не кликается.
  const prevNav: ReadingNavItem | null =
    view.prev && view.prev.unlocked
      ? { href: `/lessons/${view.prev.id}`, title: view.prev.title, kicker: "Предыдущий урок" }
      : null;
  const nextNav: ReadingNavItem | null = view.next
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
          />

          <h1 className="text-[32px] leading-[1.2] font-semibold tracking-[-0.02em]">
            {view.lesson.title}
          </h1>
          <div className="mt-2.5 mb-5 flex flex-wrap items-center gap-2">
            <Badge>{durationLabel}</Badge>
            <Badge>{DIFFICULTY_LABEL[view.lesson.difficulty]}</Badge>
            {view.lesson.isOptional && <Badge>необязательный</Badge>}
            {view.state.updatedSinceCompletion && <Badge variant="accent">обновлён</Badge>}
            <div className="ml-auto flex items-center gap-2">
              <ReadingSizeControl initial={user.readingFontSize} />
              <LessonTocSheet headings={headings} />
            </div>
          </div>

          <LessonReader
            lessonId={view.lesson.id}
            initialScrollPos={view.progress.scrollPos}
            initialVideoPos={view.progress.videoPos}
            completed={view.progress.completedAt !== null}
            impersonated={impersonated}
            pathPolicy={view.lesson.pathPolicy}
            initialSelectedPath={view.progress.selectedPath}
            hasText={Boolean(view.lesson.contentMd.trim())}
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
              <CompleteLessonButton
                lessonId={view.lesson.id}
                completed={view.progress.completedAt !== null}
              />
            </div>
            <ReadingNavCards prev={prevNav} next={nextNav} />
          </div>
        </div>

        <LessonTocRail headings={headings} title="В этом уроке" />
      </div>
      <ReportDialog lessonId={view.lesson.id} />
    </ReadingTracker>
  );
}
