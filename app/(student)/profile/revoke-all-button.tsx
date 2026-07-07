"use client";

import { ActionButton } from "@/components/features/action-button";
import { revokeAllSessionsAction } from "@/lib/actions/profile";

export function RevokeAllSessionsButton() {
  return (
    <ActionButton
      action={revokeAllSessionsAction}
      variant="secondary"
      size="md"
      className="text-danger"
      confirm={{
        title: "Выйти на всех устройствах?",
        description: "Все сессии будут завершены, включая эту — понадобится войти заново.",
        actionLabel: "Выйти на всех",
      }}
    >
      Выйти на всех
    </ActionButton>
  );
}
