"use client";

import Link from "next/link";
import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { requestResetAction, type AuthFormState } from "@/lib/actions/auth";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    requestResetAction,
    null,
  );
  const error = state && !state.ok ? state.error.message : null;

  if (state?.ok) {
    // Deliberately neutral: must not reveal whether the email exists (spec 11).
    return (
      <EmptyState
        icon={MailCheck}
        title="Проверь почту"
        description="Если такой email зарегистрирован — мы отправили ссылку для сброса пароля. Она действует один час."
        action={
          <Button asChild variant="secondary">
            <Link href="/login">Вернуться ко входу</Link>
          </Button>
        }
        className="py-6"
      />
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="forgot-email" className="text-text-2 text-[13px]">
          Email
        </label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
        />
      </div>
      {error && (
        <p role="alert" aria-live="polite" className="text-danger text-[13px]">
          {error}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full">
        Отправить ссылку
      </Button>
      <Link
        href="/login"
        className="text-text-3 ease-app hover:text-text-1 text-center text-[13px] transition-colors duration-150"
      >
        Вернуться ко входу
      </Link>
    </form>
  );
}
