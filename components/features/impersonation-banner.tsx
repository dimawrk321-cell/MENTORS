import { Eye } from "lucide-react";
import { stopImpersonationAction } from "@/lib/actions/students";
import { Button } from "@/components/ui/button";

/**
 * StudentImpersonationBanner (spec 5.3): fixed bar while an admin views the
 * platform as a student; mutations are rejected server-side (spec 7.2).
 */
export function ImpersonationBanner({ studentName }: { studentName: string }) {
  return (
    <div className="border-accent/30 bg-accent/12 sticky top-0 z-50 flex min-h-11 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-1.5 backdrop-blur">
      <p className="text-text-1 flex items-center gap-2 text-[13px]">
        <Eye size={15} strokeWidth={1.75} className="text-accent shrink-0" aria-hidden="true" />
        <span>
          Вы смотрите как <span className="font-medium">{studentName}</span> — только чтение
        </span>
      </p>
      <form action={stopImpersonationAction}>
        <Button type="submit" variant="secondary" size="sm">
          Выйти из режима
        </Button>
      </form>
    </div>
  );
}
