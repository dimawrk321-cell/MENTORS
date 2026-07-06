import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// Spec 15: 404 links back to the dashboard.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Такой страницы нет"
        description="Проверь адрес или вернись на главную"
        action={
          <Button asChild>
            <Link href="/">На главную</Link>
          </Button>
        }
      />
    </div>
  );
}
