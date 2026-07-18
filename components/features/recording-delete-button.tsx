"use client";

import { ActionButton } from "@/components/features/action-button";
import { deleteRecordingAction } from "@/lib/actions/library";

// Delete a draft recording with zero views (spec 8.5 changelog). Offered only
// when the row qualifies; the service re-checks the guard.
export function RecordingDeleteButton({ id }: { id: string }) {
  return (
    <ActionButton
      action={() => deleteRecordingAction(id)}
      variant="ghost"
      successMessage="Запись удалена"
      confirm={{
        title: "Удалить запись?",
        description: "Черновик без просмотров будет удалён безвозвратно.",
        actionLabel: "Удалить",
      }}
    >
      Удалить
    </ActionButton>
  );
}
