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
import { resetTeamMemberPasswordAction } from "@/lib/actions/team";

/** Reset a staff member's password to a fresh temp password (owner-only, 12.4/B3). */
export function ResetMemberPasswordDialog({ userId, email }: { userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ tempPassword: string; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function issue(): void {
    startTransition(async () => {
      const res = await resetTeamMemberPasswordAction(userId);
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
              Прежний пароль больше не работает. Передай новый участнику — при первом входе он
              придумает свой.
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
