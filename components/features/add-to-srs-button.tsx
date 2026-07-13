"use client";

import { useState, useTransition } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { addToSrsAction } from "@/lib/actions/srs";

// «В повторения» (spec 7.4): ручное добавление карточки из каталога и с
// FlipCard-страницы вопроса. Поверх живой карточки — no-op с тостом.

export function AddToSrsButton({
  questionId,
  initialInSrs,
  size = "md",
}: {
  questionId: string;
  initialInSrs: boolean;
  size?: "sm" | "md";
}) {
  const [inSrs, setInSrs] = useState(initialInSrs);
  const [pending, startTransition] = useTransition();
  const iconSize = size === "sm" ? 13 : 15;

  function add(): void {
    startTransition(async () => {
      const result = await addToSrsAction(questionId);
      if (!result.ok) {
        toast({ title: result.error.message, variant: "danger" });
        return;
      }
      setInSrs(true);
      if (result.data.added) {
        toast({ title: "Добавлено в повторения", variant: "success" });
      } else {
        toast({ title: "Уже в повторениях" });
      }
    });
  }

  if (inSrs) {
    return (
      <span
        className="text-text-3 inline-flex items-center gap-1.5 text-[13px]"
        aria-label="Вопрос уже в повторениях"
      >
        <Check size={iconSize} strokeWidth={1.75} aria-hidden="true" />В повторениях
      </span>
    );
  }

  return (
    <Button variant="secondary" size={size} loading={pending} onClick={add}>
      <Plus size={iconSize} strokeWidth={1.75} aria-hidden="true" />В повторения
    </Button>
  );
}
