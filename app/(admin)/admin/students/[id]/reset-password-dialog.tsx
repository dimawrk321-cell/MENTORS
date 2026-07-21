"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CredentialReveal } from "@/components/features/credential-reveal";
import { resetStudentPasswordAction } from "@/lib/actions/students";

/**
 * «Сбросить пароль» (walk 12.4/A2): resets to a fresh temporary password and
 * reveals it once (same pattern as issuing access). Sessions are NOT touched —
 * that is a separate button. The link-based reset is retired.
 */
export function ResetPasswordDialog({ userId, email }: { userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ tempPassword: string; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function issue(): void {
    startTransition(async () => {
      const res = await resetStudentPasswordAction(userId);
      if (res.ok) {
        setResult(res.data);
        setOpen(true);
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" loading={pending} onClick={issue}>
        <KeyRound size={15} strokeWidth={1.75} aria-hidden="true" />
        Сбросить пароль
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый временный пароль</DialogTitle>
            <DialogDescription>
              Прежний пароль больше не работает. Передай новый ученику — при первом входе он
              придумает свой. Активные сессии не сброшены.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <CredentialReveal
              login={email}
              tempPassword={result.tempPassword}
              message={result.message}
            />
          )}
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setOpen(false)}>Готово</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
