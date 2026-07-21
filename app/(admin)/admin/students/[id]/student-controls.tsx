"use client";

import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import { ActionButton } from "@/components/features/action-button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  blockStudentAction,
  impersonateAction,
  resetStudentSessionsAction,
  setSectionAccessAction,
  unblockStudentAction,
} from "@/lib/actions/students";

// Thin client wrappers over the admin actions: confirm dialogs + toasts.

export function ImpersonateButton({ userId }: { userId: string }) {
  return (
    <ActionButton action={() => impersonateAction(userId)} variant="secondary" size="md">
      <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
      Глазами ученика
    </ActionButton>
  );
}

export function BlockButton({ userId, name }: { userId: string; name: string }) {
  return (
    <ActionButton
      action={() => blockStudentAction(userId)}
      className="text-danger"
      successMessage="Ученик заблокирован"
      confirm={{
        title: `Заблокировать ${name}?`,
        description: "Все сессии будут завершены мгновенно, вход станет невозможен.",
        actionLabel: "Заблокировать",
      }}
    >
      Заблокировать
    </ActionButton>
  );
}

export function UnblockButton({ userId }: { userId: string }) {
  return (
    <ActionButton action={() => unblockStudentAction(userId)} successMessage="Ученик разблокирован">
      Разблокировать
    </ActionButton>
  );
}

export function ResetSessionsButton({ userId }: { userId: string }) {
  return (
    <ActionButton
      action={() => resetStudentSessionsAction(userId)}
      successMessage="Сессии и устройства сброшены"
      confirm={{
        title: "Сбросить сессии и устройства?",
        description: "Ученик будет разлогинен везде, список устройств очистится.",
        actionLabel: "Сбросить",
      }}
    >
      Сбросить сессии и устройства
    </ActionButton>
  );
}

/**
 * Per-student section access toggle (spec 7.9/7.10, 12.1/C3) — optimistic Switch.
 * Used for Библиотека / Резюме / Легенда.
 */
export function SectionAccessToggle({
  userId,
  section,
  enabled,
  label,
  onLabel,
  offLabel,
}: {
  userId: string;
  section: "library" | "resume" | "legend";
  enabled: boolean;
  label: string;
  onLabel: string;
  offLabel: string;
}) {
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function change(next: boolean): void {
    setOn(next); // optimistic (spec 15: safe optimistic updates)
    startTransition(async () => {
      const res = await setSectionAccessAction({ userId, section, enabled: next });
      if (res && !res.ok) {
        setOn(!next);
        toast({ title: res.error.message, variant: "danger" });
      } else if (res?.ok) {
        toast({ title: next ? onLabel : offLabel, variant: "success" });
      }
    });
  }

  return (
    <label className="flex items-center gap-2.5 text-[14px]">
      <Switch checked={on} onCheckedChange={change} disabled={pending} aria-label={label} />
      {label}
    </label>
  );
}
