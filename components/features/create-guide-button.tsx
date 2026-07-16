"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { createGuideAction } from "@/lib/actions/guides";

/** Create a draft guide in a section and jump to its editor (spec 8.5). */
export function CreateGuideButton({ section }: { section: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function create(): void {
    startTransition(async () => {
      const res = await createGuideAction({ section, title: "Новый гайд" });
      if (!res) return;
      if (res.ok) router.push(`/admin/content/guides/${res.data.id}`);
      else toast({ title: res.error.message, variant: "danger" });
    });
  }

  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={create}>
      <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
      Гайд
    </Button>
  );
}
