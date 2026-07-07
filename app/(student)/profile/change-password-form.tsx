"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { PasswordMeter } from "@/components/features/password-meter";
import { changePasswordAction, type ProfileFormState } from "@/lib/actions/profile";

export function ChangePasswordForm() {
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
        <Input
          id="old-password"
          name="oldPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="text-text-2 text-[13px]">
          Новый пароль
        </label>
        <Input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <PasswordMeter password={newPassword} />
      </div>
      {error && (
        <p role="alert" aria-live="polite" className="text-danger text-[13px]">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="secondary" loading={pending}>
          Сменить пароль
        </Button>
      </div>
    </form>
  );
}
