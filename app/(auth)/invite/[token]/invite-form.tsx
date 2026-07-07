"use client";

import { useState, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PasswordMeter } from "@/components/features/password-meter";
import { acceptInviteAction, type AuthFormState } from "@/lib/actions/auth";

interface InviteFormProps {
  token: string;
  /** Правила доступа из настроек (spec 8.1: чекбокс согласия). */
  rulesText: string;
}

export function InviteForm({ token, rulesText }: InviteFormProps) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    acceptInviteAction,
    null,
  );
  const [password, setPassword] = useState("");
  const error = state && !state.ok ? state.error.message : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-password" className="text-text-2 text-[13px]">
          Пароль
        </label>
        <Input
          id="invite-password"
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
      <div className="rounded-control border-border bg-surface-2 text-text-2 border p-3 text-[13px] leading-relaxed">
        {rulesText}
      </div>
      <label className="text-text-1 flex cursor-pointer items-start gap-2.5 text-[13px]">
        <Checkbox name="consent" required className="mt-0.5" />
        <span>Принимаю правила доступа к платформе</span>
      </label>
      {error && (
        <p role="alert" aria-live="polite" className="text-danger text-[13px]">
          {error}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full">
        Создать пароль и войти
      </Button>
    </form>
  );
}
