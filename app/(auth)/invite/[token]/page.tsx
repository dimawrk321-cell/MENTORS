import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { prisma } from "@/lib/db";
import { validateInviteToken } from "@/lib/services/auth";
import { getAccessRulesText } from "@/lib/services/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = {
  title: "Приглашение",
};

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const validation = await validateInviteToken(prisma, token);

  if (validation.state === "used") {
    return (
      <Card>
        <EmptyState
          icon={Clock}
          title="Инвайт уже использован"
          description="Пароль уже установлен — просто войди."
          action={
            <Button asChild>
              <Link href="/login">Войти</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  if (validation.state !== "valid") {
    // Spec 8.1: токен истёк → «Ссылка устарела, попроси новую».
    return (
      <Card>
        <EmptyState
          icon={Clock}
          title="Ссылка устарела"
          description="Попроси новую у ментора — инвайт действует 7 дней."
        />
      </Card>
    );
  }

  const rulesText = await getAccessRulesText();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">
          Привет, {validation.user.name}!
        </h1>
        <p className="text-text-3 text-[13px]">
          Тебя пригласили на платформу. Придумай пароль — и начнём.
        </p>
      </div>
      <Card>
        <CardContent className="p-5">
          <InviteForm token={token} rulesText={rulesText} />
        </CardContent>
      </Card>
    </div>
  );
}
