import Link from "next/link";
import { Play } from "lucide-react";

// Карточка прогресса курса (заход B.5, референс v2): кольцо с процентом,
// «X из Y уроков», строка состояния, три числа и CTA «Продолжить: <урок>».
//
// Кольцо — conic-gradient по токенам (--accent → --violet, остаток --surface-2),
// без SVG: GoalRing из дашборда рисует дневную цель со своими ритуалами и
// анимацией, тащить его сюда значило бы притащить и их.
//
// Числа берутся из ОДНОГО источника, что и цепь курсов: обязательные уроки
// (`completedRequired`/`totalRequired`). Необязательные уроки видны в программе
// с меткой, но ни прогресс, ни оценку времени не двигают — иначе на карточке и
// в каталоге стояли бы разные проценты одного курса.

export interface CourseProgressCardProps {
  percent: number;
  completed: number;
  total: number;
  /** Оценка оставшегося времени в минутах; null — курс пройден. */
  remainingMinutes: number | null;
  cta: { href: string; label: string } | null;
}

export function CourseProgressCard({
  percent,
  completed,
  total,
  remainingMinutes,
  cta,
}: CourseProgressCardProps) {
  const stats: { label: string; value: string }[] = [
    { label: "Уроков", value: String(total) },
    { label: "Пройдено", value: String(completed) },
    {
      label: "Осталось",
      value: remainingMinutes === null ? "—" : `${remainingMinutes} мин`,
    },
  ];

  return (
    <section
      aria-label="Прогресс курса"
      className="rounded-card border-border bg-surface-1 shadow-card flex flex-wrap items-center gap-[clamp(1rem,3vw,2rem)] border px-5 py-4.5"
    >
      <div className="flex flex-none items-center gap-3.5">
        <div
          aria-hidden="true"
          className="relative size-[58px] shrink-0 rounded-full"
          style={{
            background: `conic-gradient(var(--accent) 0turn, var(--violet) ${percent / 100}turn, var(--surface-2) ${percent / 100}turn 1turn)`,
          }}
        >
          <div className="bg-surface-1 absolute inset-[5px] flex items-center justify-center rounded-full text-[13px] font-bold tracking-[-0.02em]">
            {percent}%
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-[-0.01em]">
            {completed} из {total} уроков
          </div>
          <div className="text-text-3 text-[12.5px]">
            {remainingMinutes === null
              ? "Курс пройден полностью"
              : `Осталось ~${remainingMinutes} мин`}
          </div>
        </div>
      </div>

      <div className="flex min-w-[200px] flex-auto flex-wrap gap-5">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-[92px] flex-col gap-0.5">
            <span className="text-[19px] font-bold tracking-[-0.02em] tabular-nums">
              {stat.value}
            </span>
            <span className="text-text-3 text-[12px]">{stat.label}</span>
          </div>
        ))}
      </div>

      {cta && (
        <Link
          href={cta.href}
          // max-w-full + min-w-0 + truncate: название урока бывает длинным, а
          // flex-элемент по умолчанию меряется по содержимому — на 390px кнопка
          // растягивала СТРАНИЦУ до 557px (замер до правки, spec 13 «никакого
          // horizontal overflow»). Обрезаем подпись, а не ломаем раскладку.
          className="bg-accent hover:bg-accent-hover ease-app inline-flex h-10 max-w-full flex-none items-center justify-center gap-2 rounded-[10px] px-4.5 text-[14px] font-medium text-white transition-colors duration-150"
        >
          <Play
            size={15}
            strokeWidth={1.75}
            fill="currentColor"
            aria-hidden="true"
            className="shrink-0"
          />
          <span className="min-w-0 truncate">{cta.label}</span>
        </Link>
      )}
    </section>
  );
}
