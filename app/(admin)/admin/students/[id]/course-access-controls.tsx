"use client";

import { useState, useTransition } from "react";
import { Check, Lock, LockOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setCourseAccessAction } from "@/lib/actions/students";
import type { CourseAccessState } from "@/lib/services/course-access";

// Block 2v2.4: per-course handles in the student card — открыть досрочно,
// заблокировать (stronger than the chain), вернуть в цепь. Every change is
// audited server-side. No bulk operations by the owner's decision.

export interface CourseAccessItem {
  courseId: string;
  title: string;
  state: CourseAccessState;
  unlocksAfter: string | null;
}

const STATE_LABEL: Record<CourseAccessState, string> = {
  open_welcome: "открыт (стартовый)",
  open_system: "открыт по цепи",
  open_admin: "открыт досрочно",
  locked_chain: "закрыт",
  locked_admin: "заблокирован админом",
};

function stateBadge(state: CourseAccessState) {
  if (state === "locked_admin") return <Badge variant="danger">{STATE_LABEL[state]}</Badge>;
  if (state === "locked_chain") return <Badge>{STATE_LABEL[state]}</Badge>;
  if (state === "open_admin") return <Badge variant="accent">{STATE_LABEL[state]}</Badge>;
  return <Badge variant="success">{STATE_LABEL[state]}</Badge>;
}

export function CourseAccessControls({
  userId,
  courses,
  canManage,
}: {
  userId: string;
  courses: CourseAccessItem[];
  canManage: boolean;
}) {
  const [rows, setRows] = useState(courses);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (rows.length === 0) {
    return <p className="text-text-3 text-[14px]">Опубликованных курсов пока нет.</p>;
  }

  // Not optimistic on purpose: «вернуть в цепь» can land on either «закрыт» or
  // «открыт по цепи» depending on whether the student already earned the course,
  // so the row waits for the state the server actually resolved.
  function run(
    courseId: string,
    action: "unlock" | "lock" | "unlock_reset",
    message: string,
  ): void {
    setPendingId(courseId);
    startTransition(async () => {
      const res = await setCourseAccessAction({ userId, courseId, action });
      setPendingId(null);
      if (res.ok) {
        setRows((current) =>
          current.map((row) =>
            row.courseId === courseId ? { ...row, state: res.data.state } : row,
          ),
        );
        toast({ title: message, variant: "success" });
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  }

  return (
    <ul className="divide-border flex flex-col divide-y">
      {rows.map((row) => {
        const open = row.state.startsWith("open");
        const busy = pendingId === row.courseId;
        return (
          <li
            key={row.courseId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[14px]">
                {open ? (
                  <Check size={15} strokeWidth={1.75} className="text-success shrink-0" />
                ) : (
                  <Lock size={15} strokeWidth={1.75} className="text-text-3 shrink-0" />
                )}
                <span className="truncate">{row.title}</span>
              </span>
              {row.state === "locked_chain" && row.unlocksAfter && (
                <span className="text-text-3 ml-[23px] block text-[12px]">
                  откроется после «{row.unlocksAfter}»
                </span>
              )}
            </div>
            {stateBadge(row.state)}
            {canManage && (
              <div className="flex shrink-0 gap-1.5">
                {row.state === "locked_admin" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    onClick={() => run(row.courseId, "unlock_reset", "Курс возвращён в цепь")}
                  >
                    <LockOpen size={14} strokeWidth={1.75} aria-hidden="true" />
                    Снять блок
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    loading={busy}
                    onClick={() => run(row.courseId, "lock", "Курс заблокирован для ученика")}
                  >
                    <Lock size={14} strokeWidth={1.75} aria-hidden="true" />
                    Заблокировать
                  </Button>
                )}
                {row.state === "locked_chain" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    onClick={() => run(row.courseId, "unlock", "Курс открыт досрочно")}
                  >
                    Открыть досрочно
                  </Button>
                )}
                {row.state === "open_admin" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy}
                    onClick={() => run(row.courseId, "unlock_reset", "Курс возвращён в цепь")}
                  >
                    Вернуть в цепь
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
