import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { listFreeTrainingSources } from "@/lib/services/free-training";
import { FreeTrainingSetup } from "@/components/features/free-training-setup";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Свободная тренировка",
};

/**
 * Настройка свободного прогона (заход «Банк вопросов», B2). Наборы приходят уже
 * отфильтрованными по цепи курсов — экран ничего не решает про доступ.
 */
export default async function FreeTrainingSetupPage() {
  const { user } = await requireStudentZone();
  const sources = await listFreeTrainingSources(prisma, user.id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <BackButton href="/trainer" label="Тренажёр" />
      <PageHeader
        title="Свободная тренировка"
        subtitle="Прогон по выбранному набору — без порога и без расхода дневной очереди"
      />
      <FreeTrainingSetup sources={sources} />
    </div>
  );
}
