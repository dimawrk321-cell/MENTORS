import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { redirectIfAuthenticated } from "@/lib/auth/guards";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = {
  title: "Восстановление пароля",
};

export default async function ForgotPage() {
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
