"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { dismissBannerAction } from "@/lib/actions/announcements";
import type { ActiveBanner } from "@/lib/services/announcements";

// Dismissible banner strip above student content (spec 8.5). The × persists a
// dismissal (announcement_reads) and hides the banner optimistically.

export function AnnouncementBanners({ banners }: { banners: ActiveBanner[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [, start] = useTransition();
  const visible = banners.filter((b) => !dismissed.includes(b.id));
  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    setDismissed((prev) => [...prev, id]);
    start(async () => {
      await dismissBannerAction({ announcementId: id });
    });
  };

  return (
    <div className="mb-6 flex flex-col gap-2">
      {visible.map((banner) => (
        <div
          key={banner.id}
          className="rounded-card border-border bg-surface-1 flex items-start gap-3 border px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">{banner.title}</p>
            {banner.bodyMd && (
              <p className="text-text-2 mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap">
                {banner.bodyMd}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Скрыть объявление"
            onClick={() => dismiss(banner.id)}
            className="text-text-3 ease-app hover:text-text-1 -mr-1 flex size-7 shrink-0 items-center justify-center transition-colors duration-150"
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
