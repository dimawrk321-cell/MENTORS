"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { resendEmailCodeAction, verifyEmailAction } from "@/lib/actions/email-verification";

// Profile email-verification form (spec 12.1/C8): 6-digit code + resend with a client
// 60 s cooldown (the server enforces it authoritatively too).
const RESEND_COOLDOWN_S = 60;

export function EmailVerifyForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [verifying, startVerify] = useTransition();
  const [resending, startResend] = useTransition();
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = () => {
    startVerify(async () => {
      const res = await verifyEmailAction({ code });
      if (res.ok) {
        toast({ title: "Почта подтверждена", variant: "success" });
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  };

  const resend = () => {
    startResend(async () => {
      const res = await resendEmailCodeAction();
      if (res.ok) {
        toast({ title: "Новый код отправлен", variant: "success" });
        setCooldown(RESEND_COOLDOWN_S);
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        placeholder="6-значный код"
        aria-label="Код подтверждения"
        className="w-40"
      />
      <Button type="submit" loading={verifying} disabled={code.length !== 6}>
        Подтвердить
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={resend}
        loading={resending}
        disabled={cooldown > 0}
      >
        {cooldown > 0 ? `Отправить снова (${cooldown})` : "Отправить код снова"}
      </Button>
    </form>
  );
}
