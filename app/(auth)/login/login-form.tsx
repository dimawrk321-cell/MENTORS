"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { loginAction, type AuthFormState } from "@/lib/actions/auth";

/** Shortens a contact URL for display while the full value stays the href. */
function contactDisplay(contact: string): string {
  return contact
    .replace(/^mailto:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
}

export function LoginForm({ resetContact }: { resetContact: string | null }) {
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
        <label htmlFor="login-password" className="text-text-2 text-[13px]">
          Пароль
        </label>
        <PasswordInput
          id="login-password"
          name="password"
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
      {/* Walk 13.4/4.2: no self-serve reset (no email channel) — write to the contact. */}
      <p className="text-text-3 text-center text-[13px]">
        Забыл пароль?{" "}
        {resetContact ? (
          <a
            href={resetContact}
            target="_blank"
            rel="noreferrer"
            className="text-text-2 hover:text-text-1 underline underline-offset-2"
          >
            Напиши {contactDisplay(resetContact)}
          </a>
        ) : (
          "Напиши своему ментору"
        )}
      </p>
    </form>
  );
}
