import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, Lock } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getLessonView } from "@/lib/services/content";
import { getKeyQuestionsForLesson, getQuizQuestionsForLesson } from "@/lib/services/questions";
import { KeyQuestions } from "@/components/features/key-questions";
import { QuizWidget } from "@/components/features/quiz/quiz-widget";
import { renderLessonContent } from "@/components/blocks/lesson-renderer";
import { Watermark } from "@/components/features/watermark";
import { LessonReader } from "@/components/features/lesson-reader";
import { LessonTocRail, LessonTocSheet } from "@/components/features/lesson-toc";
import { CompleteLessonButton } from "@/components/features/complete-lesson-button";
import { ReportDialog } from "@/components/features/report-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

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
  const [keyQuestions, quizQuestions] = await Promise.all([
    getKeyQuestionsForLesson(prisma, view.lesson.id),
    getQuizQuestionsForLesson(prisma, { lessonId: view.lesson.id, userId: user.id }),
  ]);

  return (
    <div className="flex gap-10">
      <div className="mx-auto w-full max-w-[680px] min-w-0">
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

        <h1 className="text-[32px] font-semibold">{view.lesson.title}</h1>
        <div className="mt-2.5 mb-5 flex flex-wrap items-center gap-2">
          <Badge>{view.lesson.readingMinutes} мин</Badge>
          <Badge>{DIFFICULTY_LABEL[view.lesson.difficulty]}</Badge>
          {view.lesson.isOptional && <Badge>необязательный</Badge>}
          {view.state.updatedSinceCompletion && <Badge variant="accent">обновлён</Badge>}
          <div className="ml-auto">
            <LessonTocSheet headings={headings} />
          </div>
        </div>

        <LessonReader
          lessonId={view.lesson.id}
          initialScrollPos={view.progress.scrollPos}
          initialVideoPos={view.progress.videoPos}
          completed={view.progress.completedAt !== null}
          impersonated={impersonated}
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
            <article className="lesson-prose">{content}</article>
          </div>
        </LessonReader>

        {/* Автоблок ключевых вопросов + квиз (spec 7.3/7.5) */}
        <KeyQuestions questions={keyQuestions} />
        <QuizWidget lessonId={view.lesson.id} userId={user.id} questions={quizQuestions} />

        {/* Completion + prev/next (spec 7.3) */}
        <div className="border-border mt-10 flex flex-col gap-4 border-t pt-6">
          <div className="flex justify-center">
            <CompleteLessonButton
              lessonId={view.lesson.id}
              completed={view.progress.completedAt !== null}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            {view.prev && view.prev.unlocked ? (
              <Button asChild variant="ghost" size="sm" className="max-w-[45%]">
                <Link href={`/lessons/${view.prev.id}`}>
                  <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span className="truncate">{view.prev.title}</span>
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {view.next && view.next.unlocked ? (
              <Button asChild variant="ghost" size="sm" className="max-w-[45%]">
                <Link href={`/lessons/${view.next.id}`}>
                  <span className="truncate">{view.next.title}</span>
                  <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <span />
            )}
          </div>
        </div>
      </div>

      <LessonTocRail headings={headings} />
      <ReportDialog lessonId={view.lesson.id} />
    </div>
  );
}
