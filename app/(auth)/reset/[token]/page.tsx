import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { prisma } from "@/lib/db";
import { isResetTokenValid } from "@/lib/services/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Новый пароль",
};

interface ResetPageProps {
  params: Promise<{ token: string }>;
}

export default async function ResetPage({ params }: ResetPageProps) {
  const { token } = await params;
  const valid = await isResetTokenValid(prisma, token);

  if (!valid) {
    return (
      <Card>
        <EmptyState
          icon={Clock}
          title="Ссылка устарела"
          description="Ссылка для сброса действует один час и используется один раз."
          action={
            <Button asChild variant="secondary">
              <Link href="/forgot">Запросить новую</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="mb-5 text-[24px] font-semibold">Новый пароль</h1>
        <ResetForm token={token} />
      </CardContent>
    </Card>
  );
}
