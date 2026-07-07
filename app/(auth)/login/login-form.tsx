"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginAction, type AuthFormState } from "@/lib/actions/auth";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(loginAction, null);
  const error = state && !state.ok ? state.error.message : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className="text-text-2 text-[13px]">
          Email
        </label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          aria-invalid={error ? true : undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="login-password" className="text-text-2 text-[13px]">
            Пароль
          </label>
          <Link
            href="/forgot"
            className="text-text-3 ease-app hover:text-text-1 text-[13px] transition-colors duration-150"
          >
            Забыл пароль?
          </Link>
        </div>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error && (
        <p role="alert" aria-live="polite" className="text-danger text-[13px]">
          {error}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full">
        Войти
      </Button>
    </form>
  );
}
