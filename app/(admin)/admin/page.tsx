import type { Metadata } from "next";
import { Gauge } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Пульт",
};

export default function AdminDashboardPage() {
  return (
    <>
      <h1 className="mb-6 text-[24px] font-semibold">Пульт</h1>
      <EmptyState
        icon={Gauge}
        title="Пока тихо"
        description="Метрики и флаги появятся, когда ученики начнут заниматься"
      />
    </>
  );
}
