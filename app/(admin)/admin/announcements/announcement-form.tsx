"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { createAnnouncementAction } from "@/lib/actions/announcements";

// Create form for /admin/announcements (spec 8.5). Controlled state → server
// action with a plain object (no FormData/Select plumbing). Segment picker is
// built from published courses + the two fixed segments.

const fieldClass =
  "rounded-control border-border text-text-1 ease-app hover:border-border-strong h-9 w-full border bg-transparent px-3 text-[14px] transition-colors duration-150";

export function AnnouncementForm({ courses }: { courses: { id: string; title: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [kind, setKind] = useState<"banner" | "notification">("banner");
  const [segment, setSegment] = useState("all");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const submit = () => {
    start(async () => {
      const res = await createAnnouncementAction({
        title,
        bodyMd,
        kind,
        segment,
        startsAt: startsAt || undefined,
        endsAt: endsAt || undefined,
      });
      if (res.ok) {
        toast({
          title:
            kind === "notification"
              ? `Объявление отправлено (${res.data.delivered})`
              : "Баннер опубликован",
          variant: "success",
        });
        setTitle("");
        setBodyMd("");
        setStartsAt("");
        setEndsAt("");
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ann-title" className="text-text-2 text-[13px]">
          Заголовок
        </label>
        <Input
          id="ann-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ann-body" className="text-text-2 text-[13px]">
          Текст
        </label>
        <textarea
          id="ann-body"
          value={bodyMd}
          onChange={(e) => setBodyMd(e.target.value)}
          maxLength={10_000}
          required
          rows={4}
          className={`${fieldClass} h-auto py-2 leading-relaxed`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ann-kind" className="text-text-2 text-[13px]">
            Тип
          </label>
          <select
            id="ann-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "banner" | "notification")}
            className={fieldClass}
          >
            <option value="banner">Баннер над контентом</option>
            <option value="notification">Уведомление (колокольчик)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ann-segment" className="text-text-2 text-[13px]">
            Кому
          </label>
          <select
            id="ann-segment"
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className={fieldClass}
          >
            <option value="all">Все ученики</option>
            <option value="mock_this_week">С моком на этой неделе</option>
            {courses.map((course) => (
              <option key={course.id} value={`course:${course.id}`}>
                Курс: {course.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {kind === "banner" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ann-start" className="text-text-2 text-[13px]">
              Показывать с (необязательно)
            </label>
            <input
              id="ann-start"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ann-end" className="text-text-2 text-[13px]">
              Скрыть после (необязательно)
            </label>
            <input
              id="ann-end"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className={fieldClass}
            />
          </div>
        </div>
      )}

      <div>
        <Button type="submit" loading={pending} disabled={!title.trim() || !bodyMd.trim()}>
          {kind === "notification" ? "Отправить" : "Опубликовать баннер"}
        </Button>
      </div>
    </form>
  );
}
