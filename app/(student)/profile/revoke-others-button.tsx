"use client";

import { ActionButton } from "@/components/features/action-button";
import { revokeOtherSessionsAction } from "@/lib/actions/profile";

export function RevokeOtherSessionsButton() {
  return (
    <ActionButton
      action={revokeOtherSessionsAction}
      variant="secondary"
      size="md"
      successMessage="Остальные сессии завершены"
      confirm={{
        title: "Выйти на всех остальных устройствах?",
        description: "Все остальные сессии будут завершены. Эта сессия останется активной.",
        actionLabel: "Завершить остальные",
      }}
    >
      Выйти на всех остальных
    </ActionButton>
  );
}
