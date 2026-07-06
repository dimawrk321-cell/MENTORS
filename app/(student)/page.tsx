import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Главная",
};

export default function DashboardPage() {
  return (
    <>
      <h1 className="mb-6 text-[24px] font-semibold">Главная</h1>
      {/* DECISION: no CTA yet — the action would link to courses, which arrive at stage 2. */}
      <EmptyState
        icon={Sparkles}
        title="Начни с первого урока"
        description="Здесь появится твой прогресс"
      />
    </>
  );
}
