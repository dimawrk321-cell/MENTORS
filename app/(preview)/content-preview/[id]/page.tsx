import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getLessonForEditor } from "@/lib/services/content-admin";
import { renderLessonContentSafe } from "@/components/blocks/lesson-renderer";
import { getInlineQuestionsForLesson } from "@/lib/services/questions";
import { InlineQuestion } from "@/components/features/quiz/inline-question";
import { InlineQuestionUnavailable } from "@/components/blocks/inline-question-slot";
import { VideoEmbed } from "@/components/blocks/video-embed";
import { Watermark } from "@/components/features/watermark";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Предпросмотр",
};

const DIFFICULTY_LABEL = { intro: "интро", base: "база", advanced: "продвинутый" } as const;

interface PreviewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}

// DECISION: the preview lives outside the (admin) group — the editor embeds it
// in an iframe and «Открыть как ученика» opens it full-page, both without the
// admin chrome. Same LessonRenderer as the student page = identical rendering.
export default async function ContentPreviewPage({ params, searchParams }: PreviewPageProps) {
  const { user } = await requirePermission("content.manage");
  const { id } = await params;
  const lesson = await getLessonForEditor(prisma, id);
  if (!lesson) notFound();
  const { step: stepId } = await searchParams;
  const step = lesson.steps.find((item) => item.id === stepId) ?? null;
  const markdown = step?.contentMd ?? lesson.contentMd;

  // Заход B.1: вставленные в текст вопросы рисуются тем же компонентом, что у
  // ученика (spec 8.5 «предпросмотр идентичен виду ученика»), но отвечать в
  // предпросмотре некому — режим только чтение.
  const inlineQuestions = await getInlineQuestionsForLesson(prisma, markdown);
  const { content } = await renderLessonContentSafe(markdown, {
    inlineQuestion: (questionId) => {
      const entry = inlineQuestions.get(questionId);
      if (!entry?.question) {
        return <InlineQuestionUnavailable reason={entry?.problem ?? "no_id"} />;
      }
      return (
        <InlineQuestion question={entry.question} lessonId={lesson.id} userId={null} readOnly />
      );
    },
  });

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 py-8">
      <p className="text-text-3 mb-3 text-[13px]">
        {lesson.module.course.title} · {lesson.module.title}
      </p>
      <h1 className="text-[32px] font-semibold">{lesson.title}</h1>
      {lesson.steps.length > 1 && step && <p className="text-text-2 mt-2 text-lg">{step.title}</p>}
      <div className="mt-2.5 mb-5 flex flex-wrap items-center gap-2">
        <Badge>{step?.readingMinutes ?? lesson.readingMinutes} мин</Badge>
        <Badge>{DIFFICULTY_LABEL[lesson.difficulty]}</Badge>
        {lesson.isOptional && <Badge>необязательный</Badge>}
        {lesson.status === "draft" && <Badge variant="warning">черновик</Badge>}
      </div>
      {lesson.videoUrl && (
        <VideoEmbed url={lesson.videoUrl} title={lesson.title} status={lesson.videoStatus} eager />
      )}
      <div className="relative">
        <Watermark email={user.email} />
        {/* Тот же `reading-article`, что у ученика — иначе предпросмотр
            разошёлся бы с боевым видом (spec 8.5). */}
        <article className="lesson-prose reading-article">{content}</article>
      </div>
    </main>
  );
}
