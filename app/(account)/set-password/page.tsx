import type { Metadata } from "next";
import { requirePasswordSetup } from "@/lib/auth/guards";
import { Card, CardContent } from "@/components/ui/card";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "Придумай свой пароль",
  robots: { index: false, follow: false },
};

/**
 * Forced initial-password screen (walk 12.4/A2): reached after logging in with an
 * admin-issued temporary password. The guard admits only accounts with a pending
 * change and every zone guard bounces such accounts here — direct-URL bypass is
 * impossible.
 */
export default async function SetPasswordPage() {
  await requirePasswordSetup();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Придумай свой пароль</h1>
        <p className="text-text-3 text-[13px]">
          Вход выполнен по временному паролю. Задай свой — он его заменит.
        </p>
      </div>
      <Card>
        <CardContent className="p-5">
          <SetPasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
