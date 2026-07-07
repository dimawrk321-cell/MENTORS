import type { Metadata } from "next";
import { MonitorSmartphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { redirectIfAuthenticated } from "@/lib/auth/guards";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Вход",
};

interface LoginPageProps {
  searchParams: Promise<{ reason?: string; reset?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await redirectIfAuthenticated();
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      {params.reason === "evicted" && (
        // Spec 7.2: the displaced session lands here with a dedicated explanation.
        <Card role="status" className="border-warning/40">
          <CardContent className="flex gap-3 p-4">
            <MonitorSmartphone
              size={18}
              strokeWidth={1.75}
              className="text-warning mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div className="text-[13px] leading-relaxed">
              <p className="text-text-1 font-medium">Вход выполнен на другом устройстве</p>
              <p className="text-text-2">
                Одновременно можно работать только с одного устройства. Если это был не ты — смени
                пароль.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {params.reset === "1" && (
        <Card role="status" className="border-success/40">
          <CardContent className="text-text-1 p-4 text-[13px]">
            Пароль обновлён — войди с новым паролем.
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-6">
          <h1 className="mb-5 text-[24px] font-semibold">Вход</h1>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
