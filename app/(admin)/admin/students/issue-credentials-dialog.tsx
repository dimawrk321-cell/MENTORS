"use client";

import Link from "next/link";
import { useState, useActionState } from "react";
import { UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CredentialReveal } from "@/components/features/credential-reveal";
import { issueStudentCredentialsAction, type CredentialsFormState } from "@/lib/actions/students";

/**
 * «Выдать доступ» (walk 12.4/A1): creates a student account and reveals a
 * one-time login + temporary password. Email = login; name is optional (the
 * student sets it on onboarding). No invite link, no email.
 */
export function IssueCredentialsDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CredentialsFormState, FormData>(
    issueStudentCredentialsAction,
    null,
  );
  const error = state && !state.ok ? state.error.message : null;
  const created = state?.ok ? state.data : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserRoundPlus size={16} strokeWidth={1.75} aria-hidden="true" />
          Выдать доступ
        </Button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Доступ выдан</DialogTitle>
              <DialogDescription>Передай логин и временный пароль ученику лично.</DialogDescription>
            </DialogHeader>
            <CredentialReveal
              login={created.email}
              tempPassword={created.tempPassword}
              message={created.message}
            />
            <div className="mt-6 flex justify-end gap-3">
              <Button asChild variant="secondary">
                <Link href={`/admin/students/${created.userId}`}>Открыть карточку</Link>
              </Button>
              <Button onClick={() => setOpen(false)}>Готово</Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Выдать доступ</DialogTitle>
              <DialogDescription>
                Платформа создаст временный пароль. Отсчёт 90 дней начнётся с первого входа ученика.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cred-email" className="text-text-2 text-[13px]">
                  Email (он же логин)
                </label>
                <Input id="cred-email" name="email" type="email" required autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cred-name" className="text-text-2 text-[13px]">
                  Имя (необязательно)
                </label>
                <Input id="cred-name" name="name" placeholder="Ученик задаст сам на онбординге" />
              </div>
              {error && (
                <p role="alert" aria-live="polite" className="text-danger text-[13px]">
                  {error}
                </p>
              )}
              <div className="flex justify-end">
                <Button type="submit" loading={pending}>
                  Создать доступ
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
