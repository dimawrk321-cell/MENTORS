import Link from "next/link";
import { GraduationCap, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { mockLockedText, MOCK_LOCKED_TITLE } from "@/lib/constants";
import type { MockBookingAccess } from "@/lib/services/mock-access";

// Объяснение закрытой брони (заход B.1, блок 3.2). Ученик без пройденного курса
// видит ЕГО, а не пустую страницу и не редирект: пункт «Моки» в навигации виден
// всегда, значит по нему обязан открываться понятный экран.
//
// Это не лок за страйки (7.8): у того своя плашка с датой разблокировки и своей
// причиной. Два разных сообщения показываются независимо — ученик должен
// понимать, какое из них про него.

export function MockLockedNote({ access }: { access: MockBookingAccess }) {
  const next = access.nextCourse;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <p className="flex items-center gap-2 text-[16px] font-semibold">
          <Lock size={17} strokeWidth={1.75} className="text-text-3 shrink-0" aria-hidden="true" />
          {MOCK_LOCKED_TITLE}
        </p>
        <p className="text-text-2 text-[14px]">
          {mockLockedText(access.unlockingCourse?.title ?? null)}
        </p>
        {next && (
          <p className="text-text-3 flex items-center gap-2 text-[13px]">
            <GraduationCap size={15} strokeWidth={1.75} aria-hidden="true" />
            Сейчас в работе: «{next.title}» — пройдено {next.progressPct}%
          </p>
        )}
        <div>
          <Button asChild>
            <Link href={next ? `/courses/${next.slug}` : "/courses"}>
              {next ? "Продолжить курс" : "Открыть обучение"}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
