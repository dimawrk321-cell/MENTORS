"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordMeter } from "@/components/features/password-meter";
import { setInitialPasswordAction, type AuthFormState } from "@/lib/actions/auth";

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    setInitialPasswordAction,
    null,
  );
  const [password, setPassword] = useState("");
  const error = state && !state.ok ? state.error.message : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="text-text-2 text-[13px]">
          Новый пароль
        </label>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PasswordMeter password={password} />
      </div>
      {error && (
        <p role="alert" aria-live="polite" className="text-danger text-[13px]">
          {error}
        </p>
      )}
      <Button type="submit" loading={pending}>
        Сохранить и продолжить
      </Button>
    </form>
  );
}
