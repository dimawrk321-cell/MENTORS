"use client";

import { useState, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordMeter } from "@/components/features/password-meter";
import { resetPasswordAction, type AuthFormState } from "@/lib/actions/auth";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    resetPasswordAction,
    null,
  );
  const [password, setPassword] = useState("");
  const error = state && !state.ok ? state.error.message : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-password" className="text-text-2 text-[13px]">
          Новый пароль
        </label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
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
      <Button type="submit" loading={pending} className="w-full">
        Сохранить пароль
      </Button>
    </form>
  );
}
