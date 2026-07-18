import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireExpiredStudent } from "@/lib/auth/guards";
import { getExpiredSummary } from "@/lib/services/access";
import { getRenewalContact } from "@/lib/services/settings";
import { formatDateRu } from "@/lib/utils/dates";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Доступ завершён",
};

/** Farewell screen (spec 7.1.6): totals, calm tone, renewal contact. */
export default async function ExpiredPage() {
  const { user } = await requireExpiredStudent();
  const summary = await getExpiredSummary(prisma, user.id);
  const contact = await getRenewalContact(prisma);

  const stats = [
    { label: "Уроков пройдено", value: summary.lessonsCompleted },
    { label: "Всего XP", value: summary.totalXp },
    { label: "Рекорд серии", value: summary.bestStreak },
    { label: "Моков пройдено", value: summary.mocksCompleted },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold">Доступ завершён</h1>
        <p className="text-text-2 mt-2 max-w-[52ch] text-[16px]">
          {user.name}, доступ действовал до{" "}
          {user.accessUntil ? formatDateRu(user.accessUntil, user.timezone) : "сегодняшнего дня"}.
          Весь прогресс, серия и история сохранены — после продления продолжишь ровно с того же
          места.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="text-[24px] font-semibold tabular-nums">{stat.value}</div>
              <div className="text-text-2 text-[13px]">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {contact ? (
          <Button asChild size="lg">
            <a href={contact} target="_blank" rel="noreferrer">
              Продлить доступ
            </a>
          </Button>
        ) : (
          <p className="text-text-2 text-[14px]">Чтобы продлить доступ — напиши своему ментору.</p>
        )}
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="lg">
            Выйти
          </Button>
        </form>
      </div>
    </div>
  );
}
