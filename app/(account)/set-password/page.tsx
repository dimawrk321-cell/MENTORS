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
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Придумай свой пароль</h1>
          <p className="text-text-2 mt-1 text-[14px]">
            Вход выполнен по временному паролю. Задай свой — он его заменит.
          </p>
        </div>
        <SetPasswordForm />
      </CardContent>
    </Card>
  );
}
