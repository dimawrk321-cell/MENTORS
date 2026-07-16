"use client";

import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import { ActionButton } from "@/components/features/action-button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  blockStudentAction,
  impersonateAction,
  resendInviteAction,
  resetStudentSessionsAction,
  toggleLibraryAction,
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

export function ResendInviteButton({ userId }: { userId: string }) {
  return (
    <ActionButton
      action={() => resendInviteAction(userId)}
      successMessage="Новая ссылка создана и отправлена"
    >
      Отправить инвайт повторно
    </ActionButton>
  );
}

/** Per-student library toggle (spec 7.9 / 8.5) — optimistic Switch. */
export function LibraryToggle({ userId, enabled }: { userId: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function change(next: boolean): void {
    setOn(next); // optimistic (spec 15: safe optimistic updates)
    startTransition(async () => {
      const res = await toggleLibraryAction(userId, next);
      if (res && !res.ok) {
        setOn(!next);
        toast({ title: res.error.message, variant: "danger" });
      } else if (res?.ok) {
        toast({
          title: next ? "Библиотека открыта ученику" : "Библиотека скрыта у ученика",
          variant: "success",
        });
      }
    });
  }

  return (
    <label className="flex items-center gap-2.5 text-[14px]">
      <Switch
        checked={on}
        onCheckedChange={change}
        disabled={pending}
        aria-label="Доступ к библиотеке"
      />
      Доступ к библиотеке записей
    </label>
  );
}
