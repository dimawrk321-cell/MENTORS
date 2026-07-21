"use client";

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
import { createTeamMemberAction, type TeamMemberFormState } from "@/lib/actions/team";

const fieldClass =
  "rounded-control border-border text-text-1 ease-app hover:border-border-strong h-9 w-full border bg-transparent px-3 text-[14px] transition-colors duration-150";

/** «Добавить участника» (walk 12.4/B4): staff account with a one-time temp password. */
export function AddMemberDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<TeamMemberFormState, FormData>(
    createTeamMemberAction,
    null,
  );
  const error = state && !state.ok ? state.error.message : null;
  const created = state?.ok ? state.data : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserRoundPlus size={16} strokeWidth={1.75} aria-hidden="true" />
          Добавить участника
        </Button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Участник добавлен</DialogTitle>
              <DialogDescription>
                Передай логин и временный пароль участнику лично.
              </DialogDescription>
            </DialogHeader>
            <CredentialReveal
              login={created.email}
              tempPassword={created.tempPassword}
              message={created.message}
            />
            <div className="mt-6 flex justify-end">
              <Button onClick={() => setOpen(false)}>Готово</Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Добавить участника</DialogTitle>
              <DialogDescription>
                Участник получит временный пароль. Роль и права можно изменить позже.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tm-email" className="text-text-2 text-[13px]">
                  Email (он же логин)
                </label>
                <Input id="tm-email" name="email" type="email" required autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tm-name" className="text-text-2 text-[13px]">
                  Имя (необязательно)
                </label>
                <Input id="tm-name" name="name" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tm-role" className="text-text-2 text-[13px]">
                  Роль
                </label>
                <select id="tm-role" name="role" defaultValue="mentor" className={fieldClass}>
                  <option value="mentor">Ментор</option>
                  <option value="admin">Админ</option>
                </select>
              </div>
              <label className="flex items-center gap-2.5 text-[14px]">
                <input type="checkbox" name="isInterviewer" className="accent-accent size-4" />
                Интервьюер — кабинет с расписанием и проведением моков
              </label>
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
