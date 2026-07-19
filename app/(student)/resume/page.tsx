import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStudentZone } from "@/lib/auth/guards";
import { GuideSectionView } from "@/components/features/guide-section-view";

export const metadata: Metadata = { title: "Резюме" };

// Резюме section page (spec 12.1/C5), gated by the per-student flag (C3).
export default async function ResumePage() {
  const { user } = await requireStudentZone();
  if (!user.guidesResumeEnabled) notFound();
  return <GuideSectionView section="resume" />;
}
