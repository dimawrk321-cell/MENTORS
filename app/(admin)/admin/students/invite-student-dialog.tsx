"use client";

import Link from "next/link";
import { useState, useActionState } from "react";
import { UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { inviteStudentAction, type InviteFormState } from "@/lib/actions/students";

/**
 * Invite flow (spec 7.1.1 + changelog): after creation the admin sees the
 * invite link with a copy button; email is the secondary channel.
 */
export function InviteStudentDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<InviteFormState, FormData>(
    inviteStudentAction,
    null,
  );
  const error = state && !state.ok ? state.error.message : null;
  const created = state?.ok ? state.data : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserRoundPlus size={16} strokeWidth={1.75} aria-hidden="true" />
          Пригласить ученика
        </Button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Инвайт создан</DialogTitle>
              <DialogDescription>
                {created.name} ({created.email}) — ссылка действует 7 дней. Письмо с ней отправлено
                на email.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={created.inviteUrl} onFocus={(e) => e.target.select()} />
              <CopyButton value={created.inviteUrl} />
            </div>
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
              <DialogTitle>Пригласить ученика</DialogTitle>
              <DialogDescription>
                Отсчёт 90 дней доступа начнётся с момента установки пароля, не с инвайта.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="invite-name" className="text-text-2 text-[13px]">
                  Имя
                </label>
                <Input id="invite-name" name="name" required autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="invite-email" className="text-text-2 text-[13px]">
                  Email
                </label>
                <Input id="invite-email" name="email" type="email" required />
              </div>
              {error && (
                <p role="alert" aria-live="polite" className="text-danger text-[13px]">
                  {error}
                </p>
              )}
              <div className="flex justify-end">
                <Button type="submit" loading={pending}>
                  Создать инвайт
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
