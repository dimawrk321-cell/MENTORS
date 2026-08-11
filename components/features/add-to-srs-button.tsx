"use client";

import { type MouseEvent, useState, useTransition } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { addToSrsAction } from "@/lib/actions/srs";
import { useViewOnly, VIEW_ONLY_TITLE } from "@/components/features/view-only";

// «В повторения» (spec 7.4): ручное добавление карточки из каталога и с
// FlipCard-страницы вопроса. Поверх живой карточки — no-op с тостом.

export function AddToSrsButton({
  questionId,
  initialInSrs,
  size = "md",
  iconOnly = false,
}: {
  questionId: string;
  initialInSrs: boolean;
  size?: "sm" | "md";
  /** Иконка-кнопка без подписи (каталог-строка, walk 13.5 block 1.2). */
  iconOnly?: boolean;
}) {
  // «Глазами ученика»: чужие повторения не пополняем (spec 7.2) — кнопка видна,
  // но закрыта, вместо красного тоста после клика.
  const viewOnly = useViewOnly();
  const [inSrs, setInSrs] = useState(initialInSrs);
  const [pending, startTransition] = useTransition();
  const iconSize = size === "sm" ? 13 : 15;

  function add(event: MouseEvent): void {
    // Stop a <summary>-nested add (catalog row, walk 13.5) from toggling the row.
    event.stopPropagation();
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

  if (iconOnly) {
    // Square icon button; ≥44px thumb target on mobile via Button's max-md:min-h-11.
    if (inSrs) {
      return (
        <span
          className="text-success inline-flex size-8 items-center justify-center max-md:size-11"
          aria-label="Вопрос уже в повторениях"
          title="Уже в повторениях"
        >
          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
        </span>
      );
    }
    return (
      <Button
        variant="ghost"
        size="sm"
        loading={pending}
        onClick={add}
        disabled={viewOnly}
        aria-label="В повторения"
        title={viewOnly ? VIEW_ONLY_TITLE : "В повторения"}
        className="w-8 px-0 max-md:w-11"
      >
        {!pending && <Plus size={16} strokeWidth={1.75} aria-hidden="true" />}
      </Button>
    );
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
    <Button
      variant="secondary"
      size={size}
      loading={pending}
      onClick={add}
      disabled={viewOnly}
      title={viewOnly ? VIEW_ONLY_TITLE : undefined}
    >
      <Plus size={iconSize} strokeWidth={1.75} aria-hidden="true" />В повторения
    </Button>
  );
}
