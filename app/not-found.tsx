import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Spec 15: 404 links back to the dashboard. Design handoff: the numeral itself is
// the mark (no icon), centred in a card.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-2.5 px-6 py-12 text-center">
          <span className="text-text-3 text-[28px] font-bold tracking-[0.04em] tabular-nums">
            404
          </span>
          <h1 className="text-[16px] font-semibold">Такой страницы нет</h1>
          <p className="text-text-3 max-w-[36ch] text-[13px]">
            Проверь адрес или вернись на главную — всё на месте.
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-1">
            <Link href="/">На главную</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
