import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getLessonForEditor } from "@/lib/services/content-admin";
import { renderLessonContentSafe } from "@/components/blocks/lesson-renderer";
import { VideoEmbed } from "@/components/blocks/video-embed";
import { Watermark } from "@/components/features/watermark";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Предпросмотр",
};

const DIFFICULTY_LABEL = { intro: "интро", base: "база", advanced: "продвинутый" } as const;

interface PreviewPageProps {
  params: Promise<{ id: string }>;
}

// DECISION: the preview lives outside the (admin) group — the editor embeds it
// in an iframe and «Открыть как ученика» opens it full-page, both without the
// admin chrome. Same LessonRenderer as the student page = identical rendering.
export default async function ContentPreviewPage({ params }: PreviewPageProps) {
  const { user } = await requirePermission("content.manage");
  const { id } = await params;
  const lesson = await getLessonForEditor(prisma, id);
  if (!lesson) notFound();

  const content = await renderLessonContentSafe(lesson.contentMd);

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 py-8">
      <p className="text-text-3 mb-3 text-[13px]">
        {lesson.module.course.title} · {lesson.module.title}
      </p>
      <h1 className="text-[32px] font-semibold">{lesson.title}</h1>
      <div className="mt-2.5 mb-5 flex flex-wrap items-center gap-2">
        <Badge>{lesson.readingMinutes} мин</Badge>
        <Badge>{DIFFICULTY_LABEL[lesson.difficulty]}</Badge>
        {lesson.isOptional && <Badge>необязательный</Badge>}
        {lesson.status === "draft" && <Badge variant="warning">черновик</Badge>}
      </div>
      {lesson.videoUrl && (
        <VideoEmbed url={lesson.videoUrl} title={lesson.title} status={lesson.videoStatus} />
      )}
      <div className="relative">
        <Watermark email={user.email} />
        <article className="lesson-prose">{content}</article>
      </div>
    </main>
  );
}
