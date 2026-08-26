import { formatDateRu } from "@/lib/utils/dates";
import type { LevelInfo } from "@/lib/services/xp";

// Шапка профиля (референс «Профиль v2»): кто ты, с какого времени и до какого
// числа открыт доступ — слева; уровень с прогрессом — справа.
//
// Кнопки «сменить фото» здесь нет намеренно: аватар у платформы вычисляемый
// (буква имени на градиенте + `avatar_color`), загрузки фото не существует, и
// рисовать мёртвый контрол ради сходства с прототипом нельзя.

export function ProfileHeader({
  name,
  email,
  since,
  accessUntil,
  timezone,
  totalXp,
  level,
  levelTitle,
  nextLevelTitle,
  accessActive,
}: {
  name: string;
  email: string;
  since: Date;
  accessUntil: Date | null;
  timezone: string;
  totalXp: number;
  level: LevelInfo;
  levelTitle: string;
  nextLevelTitle: string;
  accessActive: boolean;
}) {
  const pct = Math.round(level.progress * 100);

  return (
    <section className="border-border flex flex-wrap items-center gap-5 border-b pb-5 md:gap-7">
      <div
        className="rounded-pill flex size-[76px] shrink-0 items-center justify-center text-[28px] font-bold tracking-[-0.02em] text-white"
        style={{ backgroundImage: "var(--gradient-accent)" }}
        aria-hidden="true"
      >
        {name.trim().charAt(0).toUpperCase()}
      </div>

      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
        <h1 className="text-[24px] leading-[1.1] font-bold tracking-[-0.025em] md:text-[32px]">
          {name}
        </h1>
        <div className="text-text-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <span className="min-w-0 break-all">{email}</span>
          <Dot />
          <span>на платформе с {formatDateRu(since, timezone)}</span>
          {accessUntil && (
            <>
              <Dot />
              <span
                className={`inline-flex items-center gap-1.5 ${
                  accessActive ? "text-success" : "text-warning"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${accessActive ? "bg-success" : "bg-warning"}`}
                />
                доступ {accessActive ? "до" : "истёк"} {formatDateRu(accessUntil, timezone)}
              </span>
            </>
          )}
        </div>
      </div>

      <div
        className="rounded-card border-border shadow-card flex flex-[0_1_268px] flex-col gap-2 border p-4"
        style={{ background: "color-mix(in srgb, var(--accent) 5%, var(--surface-1))" }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-[22px] shrink-0 items-center justify-center rounded-[7px] text-[11px] font-bold text-white tabular-nums"
            style={{ backgroundImage: "var(--gradient-accent)" }}
            aria-hidden="true"
          >
            {level.level}
          </span>
          <span className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em]">
            Уровень {level.level}
            {levelTitle ? ` · ${levelTitle}` : ""}
          </span>
          <span className="text-text-3 ml-auto shrink-0 text-[12px] tabular-nums">
            {totalXp} XP
          </span>
        </div>
        <span
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Прогресс уровня ${level.level}`}
          className="bg-surface-2 block h-1.5 overflow-hidden rounded-full"
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${pct}%`, backgroundImage: "var(--gradient-accent)" }}
          />
        </span>
        <span className="text-text-2 text-[12px]">
          <span className="tabular-nums">{level.toNext}</span> XP до уровня {level.level + 1}
          {nextLevelTitle ? ` — «${nextLevelTitle}»` : ""}
        </span>
      </div>
    </section>
  );
}

function Dot() {
  return <span aria-hidden="true" className="bg-text-3 size-[3px] rounded-full" />;
}
