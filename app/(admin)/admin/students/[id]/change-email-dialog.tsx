"use client";

import { useState, useTransition } from "react";
import { AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { changeStudentEmailAction } from "@/lib/actions/students";

/**
 * Change a student's login email (spec 13.1/D2) — owner-only (the button is only
 * rendered for the owner; the action re-checks). Active sessions are NOT reset.
 */
export function ChangeEmailDialog({ userId, currentEmail }: { userId: string; currentEmail: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(currentEmail);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    startTransition(async () => {
      const res = await changeStudentEmailAction({ userId, email });
      if (res.ok) {
        toast({ title: `Email изменён на ${res.data.email}`, variant: "success" });
        setOpen(false);
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setEmail(currentEmail);
          setOpen(true);
        }}
      >
        <AtSign size={15} strokeWidth={1.75} aria-hidden="true" />
        Сменить email
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сменить email ученика</DialogTitle>
            <DialogDescription>
              Email — это логин. Активные сессии не сбрасываются; подтверждение почты (если было)
              снимается.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex flex-col gap-4"
          >
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Новый email"
              placeholder="student@example.com"
              autoFocus
              required
            />
            <DialogFooter className="mt-0">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button
                type="submit"
                loading={pending}
                disabled={!email.trim() || email.trim().toLowerCase() === currentEmail}
              >
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
