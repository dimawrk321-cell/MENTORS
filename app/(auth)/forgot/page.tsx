import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { redirectIfAuthenticated } from "@/lib/auth/guards";
import { PASSWORD_RESET_SELF_SERVE_ENABLED } from "@/lib/constants";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = {
  title: "Восстановление пароля",
};

export default async function ForgotPage() {
  // Walk 13.4/4.2: self-serve reset is @dormant — no email channel yet.
  if (!PASSWORD_RESET_SELF_SERVE_ENABLED) notFound();
  await redirectIfAuthenticated();

  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="text-[24px] font-semibold">Восстановление пароля</h1>
        <p className="text-text-2 mt-1.5 mb-5 text-[14px]">
          Укажи email — пришлём ссылку для сброса пароля.
        </p>
        <ForgotForm />
      </CardContent>
    </Card>
  );
}
