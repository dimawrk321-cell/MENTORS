import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Расписание",
};

export default function InterviewerSchedulePage() {
  return (
    <>
      <h1 className="mb-6 text-[24px] font-semibold">Расписание</h1>
      {/* DECISION: availability rules (recurring windows, exceptions, slot preview)
          are stage-6 functionality — placeholder only for now. */}
      <EmptyState
        icon={CalendarDays}
        title="Правил доступности пока нет"
        description="Здесь появятся повторяющиеся окна, исключения и предпросмотр слотов"
      />
    </>
  );
}
