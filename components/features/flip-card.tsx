"use client";

import { useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * FlipCard (spec 5.3): 3D flip 250ms между вопросом и эталоном. Свайпы придут
 * с тренажёром (этап 4) — в каталоге переворот по кнопке/клику.
 */
export function FlipCard({ front, back }: { front: ReactNode; back: ReactNode }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative [perspective:1200px]">
        {/* Spec 5.4: reduced-motion — флип заменяется мгновенной сменой. */}
        <div
          className="ease-app relative grid transition-transform duration-250 [transform-style:preserve-3d] motion-reduce:transition-none"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {/* Скрытая грань не участвует в высоте ячейки (та же находка, что в
              SessionCardDeck): иначе короткий вопрос с длинным эталоном рисует
              экран пустоты, а кнопка переворота уезжает за нижний край. */}
          <div
            className={cn(
              "col-start-1 row-start-1 [backface-visibility:hidden]",
              flipped && "max-h-0 overflow-hidden",
            )}
            inert={flipped}
          >
            {front}
          </div>
          <div
            className={cn(
              "col-start-1 row-start-1 [transform:rotateY(180deg)] [backface-visibility:hidden]",
              !flipped && "max-h-0 overflow-hidden",
            )}
            inert={!flipped}
          >
            {back}
          </div>
        </div>
      </div>
      <div className="flex justify-center">
        <Button variant="secondary" onClick={() => setFlipped(!flipped)}>
          <RotateCw size={15} strokeWidth={1.75} aria-hidden="true" />
          {flipped ? "Показать вопрос" : "Показать ответ"}
        </Button>
      </div>
    </div>
  );
}
