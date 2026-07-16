"use client";

import { ActionButton } from "@/components/features/action-button";
import { setRecordingStatusAction } from "@/lib/actions/library";

// Quick publish/unpublish from the admin library table (spec 8.5). Publishing a
// draft with an incomplete checklist is refused server-side; the button is only
// offered when the checklist is complete so the affordance matches the gate.
export function RecordingStatusButton({
  id,
  status,
  canPublish,
}: {
  id: string;
  status: "draft" | "published";
  canPublish: boolean;
}) {
  if (status === "published") {
    return (
      <ActionButton
        action={() => setRecordingStatusAction(id, "draft")}
        successMessage="Запись снята с публикации"
      >
        В черновик
      </ActionButton>
    );
  }
  if (!canPublish) {
    return <span className="text-text-3 text-[12px]">чеклист неполон</span>;
  }
  return (
    <ActionButton
      action={() => setRecordingStatusAction(id, "published")}
      successMessage="Запись опубликована"
    >
      Опубликовать
    </ActionButton>
  );
}
