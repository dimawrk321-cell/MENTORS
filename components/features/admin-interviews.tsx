"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import type {
  AdminBookingRow,
  AdminWaitlistRow,
  StudentStrikeSummary,
  InterviewerProfileView,
} from "@/lib/services/mock-admin";
import type { RubricCriterion } from "@/lib/services/feedback";
import {
  BOOKING_STATUS_LABEL,
  MOCK_TYPE_LABEL,
  MOCK_VERDICT_LABEL,
  STRIKE_REASON_LABEL,
} from "@/lib/constants";
import { formatDateRu, formatDateTimeRu, formatDateOnlyRu } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import {
  removeStrikeAction,
  updateInterviewerProfileAction,
  upsertRubricAction,
} from "@/lib/actions/mock-admin";

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  booked: "accent",
  completed: "success",
  cancelled_student: "default",
  cancelled_interviewer: "default",
  no_show: "danger",
};

const STATUS_FILTERS = ["all", "booked", "completed", "cancelled_student", "no_show"] as const;

interface AdminInterviewsProps {
  bookings: AdminBookingRow[];
  strikes: StudentStrikeSummary[];
  waitlist: AdminWaitlistRow[];
  profiles: InterviewerProfileView[];
  rubrics: { theory: RubricCriterion[]; legend: RubricCriterion[] };
  timezone: string;
}

export function AdminInterviews(props: AdminInterviewsProps) {
  return (
    <Tabs defaultValue="bookings">
      <TabsList className="overflow-x-auto">
        <TabsTrigger value="bookings">Брони</TabsTrigger>
        <TabsTrigger value="strikes">Страйки</TabsTrigger>
        <TabsTrigger value="waitlist">Лист ожидания</TabsTrigger>
        <TabsTrigger value="rubrics">Рубрики</TabsTrigger>
        <TabsTrigger value="profiles">Интервьюеры</TabsTrigger>
      </TabsList>

      <TabsContent value="bookings">
        <BookingsTab bookings={props.bookings} timezone={props.timezone} />
      </TabsContent>
      <TabsContent value="strikes">
        <StrikesTab strikes={props.strikes} timezone={props.timezone} />
      </TabsContent>
      <TabsContent value="waitlist">
        <WaitlistTab waitlist={props.waitlist} />
      </TabsContent>
      <TabsContent value="rubrics">
        <RubricsTab rubrics={props.rubrics} />
      </TabsContent>
      <TabsContent value="profiles">
        <ProfilesTab profiles={props.profiles} />
      </TabsContent>
    </Tabs>
  );
}

function BookingsTab({ bookings, timezone }: { bookings: AdminBookingRow[]; timezone: string }) {
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const rows = filter === "all" ? bookings : bookings.filter((b) => b.status === filter);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={cn(
              "rounded-pill ease-app flex h-7 items-center px-3 text-[12px] transition-colors duration-150",
              filter === status ? "bg-surface-2 text-text-1" : "text-text-3 hover:text-text-1",
            )}
          >
            {status === "all" ? "Все" : BOOKING_STATUS_LABEL[status]}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-text-2 py-6 text-center text-[14px]">Броней нет</p>
      ) : (
        <Card>
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <li key={row.bookingId} className="flex flex-wrap items-center gap-2 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium">
                    <Link href={`/admin/students/${row.studentId}`} className="hover:text-accent">
                      {row.studentName}
                    </Link>{" "}
                    <span className="text-text-3">→ {row.interviewerName}</span>
                  </p>
                  <p className="text-text-3 text-[13px]">
                    {MOCK_TYPE_LABEL[row.type]} · {formatDateTimeRu(row.startsAt, timezone)}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[row.status] ?? "default"}>
                  {BOOKING_STATUS_LABEL[row.status]}
                </Badge>
                {row.verdict && <Badge variant="default">{MOCK_VERDICT_LABEL[row.verdict]}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function StrikesTab({ strikes, timezone }: { strikes: StudentStrikeSummary[]; timezone: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const remove = (strikeId: string) =>
    start(async () => {
      const res = await removeStrikeAction({ strikeId });
      if (res.ok) {
        toast({ title: "Страйк снят", variant: "success" });
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });

  if (strikes.length === 0) {
    return <p className="text-text-2 py-6 text-center text-[14px]">Страйков нет</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {strikes.map((student) => (
        <Card key={student.studentId}>
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/students/${student.studentId}`}
                className="hover:text-accent text-[15px] font-medium"
              >
                {student.studentName}
              </Link>
              {student.lock && (
                <Badge variant="danger">
                  Лок до {formatDateRu(student.lock.lockedUntil, timezone)}
                </Badge>
              )}
            </div>
            <ul className="divide-border divide-y">
              {student.strikes.map((strike) => (
                <li key={strike.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="text-[13px]">{STRIKE_REASON_LABEL[strike.reason]}</span>
                  <span className="text-text-3 text-[13px]">
                    {formatDateTimeRu(strike.createdAt, timezone)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger ml-auto"
                    loading={pending}
                    onClick={() => remove(strike.id)}
                  >
                    Снять
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function WaitlistTab({ waitlist }: { waitlist: AdminWaitlistRow[] }) {
  if (waitlist.length === 0) {
    return <p className="text-text-2 py-6 text-center text-[14px]">Лист ожидания пуст</p>;
  }
  return (
    <Card>
      <ul className="divide-border divide-y">
        {waitlist.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">{entry.studentName}</p>
              <p className="text-text-3 text-[13px]">
                {MOCK_TYPE_LABEL[entry.type]} · {entry.interviewerName ?? "любой интервьюер"} · до{" "}
                {formatDateOnlyRu(entry.untilDate)}
              </p>
            </div>
            <Badge variant={entry.status === "offered" ? "accent" : "default"}>
              {entry.status === "offered" ? "Предложен слот" : "Ждёт"}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RubricsTab({
  rubrics,
}: {
  rubrics: { theory: RubricCriterion[]; legend: RubricCriterion[] };
}) {
  return (
    <div className="flex flex-col gap-6">
      <RubricEditor type="theory" initial={rubrics.theory} />
      <RubricEditor type="legend" initial={rubrics.legend} />
    </div>
  );
}

function RubricEditor({
  type,
  initial,
}: {
  type: "theory" | "legend";
  initial: RubricCriterion[];
}) {
  const [criteria, setCriteria] = useState<RubricCriterion[]>(initial);
  const [pending, start] = useTransition();
  const router = useRouter();

  const update = (index: number, field: "key" | "title", value: string) =>
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  const add = () => setCriteria((prev) => [...prev, { key: "", title: "" }]);
  const remove = (index: number) => setCriteria((prev) => prev.filter((_, i) => i !== index));

  const save = () =>
    start(async () => {
      const res = await upsertRubricAction({ type, criteria });
      if (res.ok) {
        toast({ title: "Рубрика сохранена", variant: "success" });
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[15px] font-semibold">Рубрика: {MOCK_TYPE_LABEL[type]}</p>
        <div className="flex flex-col gap-2">
          {criteria.map((criterion, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Input
                value={criterion.key}
                onChange={(e) => update(index, "key", e.target.value)}
                placeholder="ключ (латиница)"
                className="w-40"
                aria-label="Ключ критерия"
              />
              <Input
                value={criterion.title}
                onChange={(e) => update(index, "title", e.target.value)}
                placeholder="Название критерия"
                className="min-w-40 flex-1"
                aria-label="Название критерия"
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Удалить критерий"
                onClick={() => remove(index)}
              >
                <Trash2 size={15} strokeWidth={1.75} />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={add}>
            <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
            Критерий
          </Button>
          <Button size="sm" loading={pending} onClick={save}>
            Сохранить рубрику
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfilesTab({ profiles }: { profiles: InterviewerProfileView[] }) {
  return (
    <div className="flex flex-col gap-4">
      {profiles.map((profile) => (
        <ProfileEditor key={profile.userId} profile={profile} />
      ))}
    </div>
  );
}

function ProfileEditor({ profile }: { profile: InterviewerProfileView }) {
  const [roomUrl, setRoomUrl] = useState(profile.roomUrl);
  const [active, setActive] = useState(profile.active);
  const [pending, start] = useTransition();
  const router = useRouter();

  const save = () =>
    start(async () => {
      const res = await updateInterviewerProfileAction({
        userId: profile.userId,
        roomUrl,
        bio: profile.bio,
        active,
      });
      if (res.ok) {
        toast({ title: "Профиль сохранён", variant: "success" });
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[15px] font-semibold">{profile.name}</p>
        <label className="flex flex-col gap-1">
          <span className="text-text-3 text-[12px]">Ссылка на комнату</span>
          <Input
            type="url"
            value={roomUrl}
            onChange={(e) => setRoomUrl(e.target.value)}
            placeholder="https://telemost.yandex.ru/..."
            aria-label="Ссылка на комнату"
          />
        </label>
        <label className="flex items-center gap-3">
          <Switch checked={active} onCheckedChange={setActive} aria-label="Активен" />
          <span className="text-[14px]">Принимает брони</span>
        </label>
        <div>
          <Button size="sm" loading={pending} onClick={save}>
            Сохранить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
