"use client";

import { Eye } from "lucide-react";
import { ActionButton } from "@/components/features/action-button";
import {
  blockStudentAction,
  impersonateAction,
  resendInviteAction,
  resetStudentSessionsAction,
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
