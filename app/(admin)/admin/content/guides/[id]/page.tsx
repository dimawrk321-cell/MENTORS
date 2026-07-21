import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { getGuideForEditor } from "@/lib/services/guides";
import { GuideEditor } from "./guide-editor";

export const metadata: Metadata = {
  title: "Редактор гайда",
};

interface GuideEditorPageProps {
  params: Promise<{ id: string }>;
}

export default async function GuideEditorPage({ params }: GuideEditorPageProps) {
  await requirePermission("content.manage");
  const { id } = await params;
  const guide = await getGuideForEditor(prisma, id);
  if (!guide) notFound();

  return (
    <GuideEditor
      guide={{
        id: guide.id,
        title: guide.title,
        slug: guide.slug,
        section: guide.section,
        order: guide.order,
        contentMd: guide.contentMd,
        status: guide.status,
      }}
    />
  );
}
