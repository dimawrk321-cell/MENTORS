"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { updateNameAction, type ProfileFormState } from "@/lib/actions/profile";
import { useViewOnly, VIEW_ONLY_TITLE } from "@/components/features/view-only";

/** Edit the student's own name (walk 12.4: «имя редактируется в профиле»). */
export function NameForm({ initialName }: { initialName: string }) {
  // «Глазами ученика»: имя чужое, править нельзя (spec 7.2).
  const viewOnly = useViewOnly();
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(
    updateNameAction,
    null,
  );
  const [name, setName] = useState(initialName);
  const error = state && !state.ok ? state.error.message : null;
  const changed = name.trim() !== initialName.trim();

  useEffect(() => {
    if (state?.ok) toast({ title: "Имя обновлено", variant: "success" });
  }, [state]);

  return (
    <form action={formAction} className="flex items-start gap-2">
      <div className="flex-1">
        <Input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={50}
          aria-label="Имя"
          disabled={viewOnly}
        />
        {error && (
          <p role="alert" aria-live="polite" className="text-danger mt-1 text-[13px]">
            {error}
          </p>
        )}
      </div>
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        disabled={!changed || viewOnly}
        title={viewOnly ? VIEW_ONLY_TITLE : undefined}
      >
        Сохранить
      </Button>
    </form>
  );
}
