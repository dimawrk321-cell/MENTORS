"use client";

import { useState } from "react";
import { ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils/cn";
import type { LessonHeading } from "@/lib/utils/markdown";

// Lesson table of contents: slim sticky rail on xl desktops (LessonTocRail),
// Sheet-шторка on mobile (LessonTocSheet) — spec 13 + changelog (Sheet ships
// with its first consumer).

function TocLinks({
  headings,
  onNavigate,
}: {
  headings: LessonHeading[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Оглавление урока">
      <ul className="flex flex-col gap-0.5">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              onClick={onNavigate}
              className={cn(
                "rounded-control text-text-2 ease-app hover:bg-surface-2 hover:text-text-1 block px-2 py-1.5 text-[13px] transition-colors duration-150",
                heading.depth === 3 && "pl-5",
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function LessonTocRail({ headings }: { headings: LessonHeading[] }) {
  if (headings.length < 2) return null;
  return (
    <aside className="sticky top-10 hidden max-h-[calc(100dvh-5rem)] w-56 shrink-0 self-start overflow-y-auto xl:block">
      <p className="text-text-3 mb-2 px-2 text-[12px] font-medium tracking-wide uppercase">
        Оглавление
      </p>
      <TocLinks headings={headings} />
    </aside>
  );
}

export function LessonTocSheet({ headings }: { headings: LessonHeading[] }) {
  const [open, setOpen] = useState(false);
  if (headings.length < 2) return null;

  return (
    <div className="xl:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="secondary" size="sm">
            <ListTree size={15} strokeWidth={1.75} aria-hidden="true" />
            Оглавление
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Оглавление</SheetTitle>
          <TocLinks headings={headings} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
