"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { issuePasswordResetLinkAction } from "@/lib/actions/students";

/**
 * Admin-issued password-reset link (walk 12.3, P1). Mirrors the invite copy flow:
 * one click creates a fresh 1h one-time token and reveals the copyable link (email
 * is the secondary channel). Sessions are NOT touched — that is a separate button.
 */
export function ResetPasswordDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function issue(): void {
    startTransition(async () => {
      const res = await issuePasswordResetLinkAction(userId);
      if (res.ok) {
        setResetUrl(res.data.resetUrl);
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
            <DialogTitle>Ссылка для сброса пароля</DialogTitle>
            <DialogDescription>
              Отправь ссылку ученику любым удобным способом. Действует 1 час, одноразовая; прежние
              ссылки сброса больше не работают. Письмо с ней также ушло на email.
            </DialogDescription>
          </DialogHeader>
          {resetUrl && (
            <div className="flex items-center gap-2">
              <Input readOnly value={resetUrl} onFocus={(e) => e.target.select()} />
              <CopyButton value={resetUrl} />
            </div>
          )}
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setOpen(false)}>Готово</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
