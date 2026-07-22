"use client";

import { ActionButton } from "@/components/features/action-button";
import { resolveSecurityFlagAction, terminateSessionAction } from "@/lib/actions/security";

// D3 (spec 13.1): thin client wrappers so the server page can pass only ids
// (ActionButton needs a bound action, which a server component can't inline).

export function TerminateSessionButton({ sessionId }: { sessionId: string }) {
  return (
    <ActionButton
      action={() => terminateSessionAction(sessionId)}
      successMessage="Сессия завершена"
      confirm={{
        title: "Завершить сессию?",
        description: "Ученика выбьет из этой сессии при следующем запросе.",
        actionLabel: "Завершить",
      }}
    >
      Завершить
    </ActionButton>
  );
}

export function ResolveFlagButton({ flagId }: { flagId: string }) {
  return (
    <ActionButton action={() => resolveSecurityFlagAction(flagId)} successMessage="Флаг закрыт">
      Разрешить
    </ActionButton>
  );
}
