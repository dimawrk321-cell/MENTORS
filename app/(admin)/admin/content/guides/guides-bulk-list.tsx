"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BookMarked } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import { CreateGuideButton } from "@/components/features/create-guide-button";
import { GUIDE_SECTIONS, GUIDE_SECTION_LABEL } from "@/lib/constants";
import { useRowSelection, pageCheckState } from "@/lib/hooks/use-row-selection";
import { bulkGuideStatusAction } from "@/lib/actions/guides";

export interface GuideRow {
  id: string;
  slug: string;
  section: string;
  title: string;
  status: "draft" | "published";
}

// C2 (spec 13.1): studio guides list with row checkboxes + a per-section select-all
// header and a bulk publish/draft toolbar. Section-wide bulk = select the section
// header then apply; per-selection bulk = check individual rows.
export function GuidesBulkList({ guides }: { guides: GuideRow[] }) {
  const router = useRouter();
  const selection = useRowSelection();
  const [pending, startTransition] = useTransition();

  function runBulk(status: "draft" | "published"): void {
    startTransition(async () => {
      const result = await bulkGuideStatusAction({ guideIds: [...selection.selected], status });
      if (!result) return;
      if (result.ok) {
        toast({ title: result.data.message, variant: "success" });
        selection.clear();
        router.refresh();
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {selection.size > 0 && (
        <Card className="sticky top-2 z-10 flex flex-wrap items-center gap-3 p-3">
          <span className="text-text-2 text-[13px]">Выбрано: {selection.size}</span>
          <Button variant="secondary" size="sm" loading={pending} onClick={() => runBulk("published")}>
            Опубликовать
          </Button>
          <Button variant="secondary" size="sm" loading={pending} onClick={() => runBulk("draft")}>
            В черновик
          </Button>
          <Button variant="ghost" size="sm" onClick={selection.clear}>
            Снять выбор
          </Button>
        </Card>
      )}

      {GUIDE_SECTIONS.map((section) => {
        const items = guides.filter((g) => g.section === section);
        const sectionIds = items.map((g) => g.id);
        return (
          <section key={section} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {items.length > 0 && (
                  <Checkbox
                    checked={pageCheckState(selection, sectionIds)}
                    onCheckedChange={() => {
                      const allOn = sectionIds.every((id) => selection.has(id));
                      selection.setMany(sectionIds, !allOn);
                    }}
                    aria-label={`Выбрать секцию «${GUIDE_SECTION_LABEL[section] ?? section}»`}
                  />
                )}
                <h2 className="text-[15px] font-semibold">
                  {GUIDE_SECTION_LABEL[section] ?? section}
                  <span className="text-text-3 ml-2 text-[13px] font-normal">{items.length}</span>
                </h2>
              </div>
              <CreateGuideButton section={section} />
            </div>
            {items.length === 0 ? (
              <div className="rounded-control border-border text-text-3 border border-dashed px-3 py-4 text-center text-[13px]">
                В этой секции пока нет гайдов — создай первый кнопкой выше.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {items.map((guide) => (
                  <Card key={guide.id} className="flex items-center gap-3 p-3">
                    <Checkbox
                      checked={selection.has(guide.id)}
                      onCheckedChange={() => selection.toggle(guide.id)}
                      aria-label={`Выбрать гайд «${guide.title}»`}
                    />
                    <Link
                      href={`/admin/content/guides/${guide.id}`}
                      className="group flex min-w-0 flex-1 items-center gap-3"
                    >
                      <BookMarked
                        size={15}
                        strokeWidth={1.75}
                        aria-hidden="true"
                        className="text-text-3 shrink-0"
                      />
                      <span className="text-text-1 group-hover:text-accent min-w-0 flex-1 truncate text-[14px]">
                        {guide.title}
                      </span>
                      <span className="text-text-3 hidden text-[12px] sm:inline">/{guide.slug}</span>
                      {guide.status === "published" ? (
                        <Badge variant="success">опубликован</Badge>
                      ) : (
                        <Badge>черновик</Badge>
                      )}
                    </Link>
                  </Card>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
