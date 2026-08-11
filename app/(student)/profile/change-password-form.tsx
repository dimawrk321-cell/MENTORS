"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toast";
import { PasswordMeter } from "@/components/features/password-meter";
import { changePasswordAction, type ProfileFormState } from "@/lib/actions/profile";
import { useViewOnly, ViewOnlyNote, VIEW_ONLY_TITLE } from "@/components/features/view-only";

export function ChangePasswordForm() {
  // «Глазами ученика»: чужой пароль не меняем (spec 7.2). Форму закрываем на
  // входе — раньше отказ прилетал после заполненных полей.
  const viewOnly = useViewOnly();
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(
    changePasswordAction,
    null,
  );
  const [newPassword, setNewPassword] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const error = state && !state.ok ? state.error.message : null;

  useEffect(() => {
    if (state?.ok) {
      toast({ title: "Пароль обновлён", variant: "success" });
      formRef.current?.reset();
      setNewPassword("");
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex max-w-sm flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="old-password" className="text-text-2 text-[13px]">
          Текущий пароль
        </label>
        <PasswordInput
          id="old-password"
          name="oldPassword"
          autoComplete="current-password"
          required
          disabled={viewOnly}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="text-text-2 text-[13px]">
          Новый пароль
        </label>
        <PasswordInput
          id="new-password"
          name="newPassword"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={viewOnly}
        />
        <PasswordMeter password={newPassword} />
      </div>
      {error && (
        <p role="alert" aria-live="polite" className="text-danger text-[13px]">
          {error}
        </p>
      )}
      {viewOnly && <ViewOnlyNote>Режим просмотра: пароль ученика не меняется.</ViewOnlyNote>}
      <div>
        <Button
          type="submit"
          variant="secondary"
          loading={pending}
          disabled={viewOnly}
          title={viewOnly ? VIEW_ONLY_TITLE : undefined}
        >
          Сменить пароль
        </Button>
      </div>
    </form>
  );
}
