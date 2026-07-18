"use client";

import { useState, useActionState } from "react";
import { UserRoundCog } from "lucide-react";
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
import { inviteMentorAction, type InviteFormState } from "@/lib/actions/students";

/**
 * Invite a mentor (spec 2: назначать роли — owner-only). Same invite flow as
 * students, role mentor + is_interviewer checkbox — closes the manual-SQL path.
 */
export function InviteMentorDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<InviteFormState, FormData>(
    inviteMentorAction,
    null,
  );
  const error = state && !state.ok ? state.error.message : null;
  const created = state?.ok ? state.data : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <UserRoundCog size={16} strokeWidth={1.75} aria-hidden="true" />
          Пригласить ментора
        </Button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Инвайт ментора создан</DialogTitle>
              <DialogDescription>
                {created.name} ({created.email}) — ссылка действует 7 дней. Письмо с ней отправлено
                на email.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={created.inviteUrl} onFocus={(e) => e.target.select()} />
              <CopyButton value={created.inviteUrl} />
            </div>
            {/* Нет ссылки «Открыть карточку»: карточка /admin/students/[id] — только
                для учеников (getStudentDetail отсекает не-student роли), у ментора её нет. */}
            <div className="mt-6 flex justify-end">
              <Button onClick={() => setOpen(false)}>Готово</Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Пригласить ментора</DialogTitle>
              <DialogDescription>
                Ментор получает доступ к контенту, ученикам и аналитике. Роль назначается сразу,
                срок доступа не ограничен.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mentor-name" className="text-text-2 text-[13px]">
                  Имя
                </label>
                <Input id="mentor-name" name="name" required autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mentor-email" className="text-text-2 text-[13px]">
                  Email
                </label>
                <Input id="mentor-email" name="email" type="email" required />
              </div>
              <label className="flex items-center gap-2.5 text-[14px]">
                <input type="checkbox" name="isInterviewer" className="accent-accent size-4" />
                Интервьюер — открыть кабинет с расписанием и проведением моков
              </label>
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
