"use client";

import { useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * FlipCard (spec 5.3): 3D flip 250ms между вопросом и эталоном. Свайпы придут
 * с тренажёром (этап 4) — в каталоге переворот по кнопке/клику.
 */
export function FlipCard({ front, back }: { front: ReactNode; back: ReactNode }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative [perspective:1200px]">
        <div
          className="ease-app relative grid transition-transform duration-250 [transform-style:preserve-3d]"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          <div className="col-start-1 row-start-1 [backface-visibility:hidden]">{front}</div>
          <div className="col-start-1 row-start-1 [transform:rotateY(180deg)] [backface-visibility:hidden]">
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
