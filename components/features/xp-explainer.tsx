import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dayCountingLabels, xpRows } from "@/lib/utils/xp-explain";
import type { XpMap } from "@/lib/services/xp";

// «XP, цель и серия» — справка ученику (заход B.2, блок 1.2).
//
// Живёт в профиле: сюда ведёт ссылка из блока дневной цели на дашборде, и
// рядом лежат настройки, которые на эти числа влияют. Значения — из карты XP
// платформы (`getXpMap`, редактируется в /admin/settings), список «что
// засчитывает день» — из `STREAK_QUALIFYING_EVENTS`. Констант в вёрстке нет:
// поменяли значение в настройках — поменялось и объяснение.

export function XpExplainer({ xpMap, goal }: { xpMap: XpMap; goal: number }) {
  const rows = xpRows(xpMap);
  const dayLabels = dayCountingLabels();

  return (
    <Card id="xp" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>XP, цель и серия</CardTitle>
        <CardDescription>
          Три разные вещи, которые часто путают. Здесь — как каждая считается.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-[14px]">
        <section className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold">Серия: что засчитывает день</h3>
          <p className="text-text-2">
            День попадает в серию, если за него случилось хотя бы одно учебное действие. Набирать
            дневную цель для этого <span className="text-text-1">не нужно</span>.
          </p>
          <ul className="text-text-2 flex flex-col gap-1">
            {dayLabels.map((label) => (
              <li key={label} className="flex gap-2">
                <span aria-hidden="true">·</span>
                {label}
              </li>
            ))}
          </ul>
          <p className="text-text-3 text-[13px]">
            Считаются только твои учебные дни — остальные дни серию не рвут. Пропустил учебный день
            — выручит заморозка, если она есть.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold">Дневная цель</h3>
          <p className="text-text-2">
            Отдельная шкала: сколько XP набрать за день. Твоя цель —{" "}
            <span className="text-text-1 tabular-nums">{goal}</span> XP. Кольцо на дашборде
            показывает именно её; на серию оно не влияет.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold">За что даётся XP</h3>
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li
                key={row.key}
                className="border-border flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b py-2 last:border-b-0"
              >
                <span className="min-w-0">
                  {row.label}
                  <span className="text-text-3 ml-2 text-[13px]">{row.note}</span>
                </span>
                <span className="text-text-1 shrink-0 tabular-nums">+{row.amount}</span>
              </li>
            ))}
          </ul>
          <p className="text-text-3 text-[13px]">
            Свободная тренировка XP не даёт и день не засчитывает — это прогон без последствий.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
