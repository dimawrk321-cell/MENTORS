import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  FileWarning,
  Link2Off,
  ShieldAlert,
  UserX,
  VideoOff,
  XCircle,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { getPultData, type MetricDelta } from "@/lib/services/admin-dashboard";
import { emitEvent } from "@/lib/services/events";
import { formatDateRu, pluralRu } from "@/lib/utils/dates";
import { Card } from "@/components/ui/card";
import { ResolveReportButton } from "./resolve-report-button";

export const metadata: Metadata = { title: "Пульт" };

// /admin (Пульт, spec 8.5): weekly metrics with delta + red-flag widgets.
// Data is cached 10 min (spec 12/7.13). mentor+ (nav filters sections by role).
export default async function AdminDashboardPage() {
  const { user } = await requirePermission("analytics.view");
  const data = await getPultData();
  // dashboard.viewed (spec 7.13 «События») — без деталей.
  await emitEvent(prisma, "dashboard.viewed", {}, { userId: user.id });

  const { metrics, flags } = data;
  // Walk 12.4/B2: resolving a content report needs content.manage — mirror the
  // view/mutate split in the UI (the action fails closed regardless).
  const canResolveReports = hasPermission(user, "content.manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[24px] font-semibold">Пульт</h1>
        <p className="text-text-2 mt-1 text-[14px]">Неделя к неделе · красные флаги</p>
      </div>

      {/* Метрики недели */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Активные ученики" metric={metrics.activeStudents} />
        <MetricCard label="Завершено уроков" metric={metrics.lessonsCompleted} />
        <MetricCard label="Сдано тестов" metric={metrics.testsPassed} />
        <MetricCard label="Проведено моков" metric={metrics.mocksCompleted} />
      </div>

      {/* Красные флаги */}
      <div className="grid gap-4 md:grid-cols-2">
        <FlagWidget
          icon={UserX}
          title="Пропали 7+ дней"
          count={flags.missing.length}
          empty="Все ученики на связи."
        >
          {flags.missing.map((s) => (
            <FlagRowLink key={s.id} href={`/admin/students/${s.id}?tab=events`} label={s.name}>
              {s.lastSeenAt
                ? `не заходил ${s.daysMissing} ${pluralRu(s.daysMissing, "день", "дня", "дней")}`
                : "не заходил ни разу"}
            </FlagRowLink>
          ))}
        </FlagWidget>

        <FlagWidget
          icon={XCircle}
          title="3 провала теста подряд"
          count={flags.failingThree.length}
          empty="Нет учеников с серией провалов."
        >
          {flags.failingThree.map((s) => (
            <FlagRowLink key={s.id} href={`/admin/students/${s.id}?tab=tests`} label={s.name}>
              {s.email}
            </FlagRowLink>
          ))}
        </FlagWidget>

        <FlagWidget
          icon={ShieldAlert}
          title="Security-флаги"
          count={flags.securityFlags.length}
          empty="Открытых флагов нет."
          href="/admin/security"
        >
          {flags.securityFlags.map((f) => (
            <FlagRowLink key={f.id} href={f.href} label={f.label}>
              {f.meta === "concurrent_geo" ? "вход из разных городов" : f.meta}
            </FlagRowLink>
          ))}
        </FlagWidget>

        <FlagWidget
          icon={VideoOff}
          title="Видео недоступны"
          count={flags.videoUnavailable.length}
          empty="Все видео на месте."
        >
          {flags.videoUnavailable.map((f) => (
            <FlagRowLink key={f.id} href={f.href} label={f.label}>
              {f.meta}
            </FlagRowLink>
          ))}
        </FlagWidget>

        <FlagWidget
          icon={CalendarClock}
          title={`Доступ истекает ≤14 дней: ${flags.expiring.length}`}
          count={flags.expiring.length}
          empty="Ни у кого не истекает в ближайшие 2 недели."
        >
          {flags.expiring.map((s) => (
            <FlagRowLink key={s.id} href={`/admin/students/${s.id}`} label={s.name}>
              до {formatDateRu(s.accessUntil, user.timezone)} · {s.daysLeft}{" "}
              {pluralRu(s.daysLeft, "день", "дня", "дней")}
            </FlagRowLink>
          ))}
        </FlagWidget>

        <FlagWidget
          icon={Link2Off}
          title="Записи со старыми ссылками"
          count={flags.staleRecordings.length}
          empty="Все ссылки свежие."
        >
          {flags.staleRecordings.map((f) => (
            <FlagRowLink key={f.id} href={f.href} label={f.label}>
              {f.meta}
            </FlagRowLink>
          ))}
        </FlagWidget>

        <FlagWidget
          icon={FileWarning}
          title="Открытые репорты контента"
          count={flags.openReports.length}
          empty="Открытых репортов нет."
          className="md:col-span-2"
        >
          {flags.openReports.map((r) => {
            const body = (
              <>
                <span className="text-text-1 font-medium">
                  {r.type === "error" ? "Ошибка" : "Непонятно"} · {r.target}
                </span>
                {r.text && <span className="text-text-3 mt-0.5 block truncate">«{r.text}»</span>}
                <span className="text-text-3 block">{r.authorName}</span>
              </>
            );
            return (
              <li key={r.id} className="flex items-start justify-between gap-3 py-1.5">
                {r.href ? (
                  <Link
                    href={r.href}
                    className="ease-app hover:text-text-1 min-w-0 flex-1 text-[13px] transition-colors duration-150"
                  >
                    {body}
                  </Link>
                ) : (
                  // General report (no lesson/question) — nowhere to navigate; render
                  // as plain text so the row isn't a dead link (spec 12.1/A2).
                  <div className="min-w-0 flex-1 text-[13px]">{body}</div>
                )}
                {canResolveReports && <ResolveReportButton reportId={r.id} />}
              </li>
            );
          })}
        </FlagWidget>
      </div>
    </div>
  );
}

function MetricCard({ label, metric }: { label: string; metric: MetricDelta }) {
  const { delta } = metric;
  const Arrow = delta >= 0 ? ArrowUpRight : ArrowDownRight;
  const color = delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-text-3";
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-text-2 text-[13px]">{label}</span>
      <span className="text-[28px] leading-none font-semibold">{metric.current}</span>
      <span className={`flex items-center gap-1 text-[12px] ${color}`}>
        <Arrow size={13} strokeWidth={2} aria-hidden="true" />
        {delta === 0 ? "без изменений" : `${delta > 0 ? "+" : ""}${delta} к прошлой неделе`}
      </span>
    </Card>
  );
}

function FlagWidget({
  icon: Icon,
  title,
  count,
  empty,
  className,
  href,
  children,
}: {
  icon: typeof AlertTriangle;
  title: string;
  count: number;
  empty: string;
  className?: string;
  /** D3 (spec 13.1): makes the widget title a link to a full page (e.g. /admin/security). */
  href?: string;
  children: ReactNode;
}) {
  return (
    <Card className={`flex flex-col gap-2 p-4 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <Icon
          size={16}
          strokeWidth={1.75}
          className={count > 0 ? "text-warning" : "text-text-3"}
          aria-hidden="true"
        />
        {href ? (
          <Link href={href} className="hover:text-accent flex-1 text-[14px] font-semibold">
            {title}
          </Link>
        ) : (
          <h2 className="flex-1 text-[14px] font-semibold">{title}</h2>
        )}
      </div>
      {count === 0 ? (
        <p className="text-text-3 text-[13px]">{empty}</p>
      ) : (
        <ul className="divide-border flex flex-col divide-y">{children}</ul>
      )}
    </Card>
  );
}

function FlagRowLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="py-1.5">
      <Link
        href={href}
        className="ease-app hover:text-text-1 block text-[13px] transition-colors duration-150"
      >
        <span className="text-text-1 font-medium">{label}</span>
        <span className="text-text-3 ml-2">{children}</span>
      </Link>
    </li>
  );
}
