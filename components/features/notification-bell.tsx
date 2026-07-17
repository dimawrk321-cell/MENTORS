"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { markNotificationsReadAction } from "@/lib/actions/notifications";

// NotificationBell (spec 5.3/7.12): unread badge + popover of the last 20 in-app
// notifications, «Прочитать все», click = mark read + navigate. Polls the API
// every 60s (no websockets — spec task). Mounted in the student and interviewer
// zone headers; fetches its own data so it can drop into any header.

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 60_000;

/** Compact relative time in Russian («5 мин назад», «вчера»). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "только что";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} мин назад`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн назад`;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(then);
}

export function NotificationBell({ className }: { className?: string }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [, startTransition] = useTransition();
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; items: NotificationItem[] };
      if (!mounted.current) return;
      setUnread(data.unread);
      setItems(data.items);
      setLoaded(true);
    } catch {
      // Network hiccup — keep the last known state, next poll retries.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Refresh when the popover opens so the list is current on view.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const markRead = useCallback(
    (ids: string[]) => {
      // Optimistic (spec 15: read-marking is safe to update optimistically).
      setItems((prev) =>
        prev.map((n) =>
          ids.includes(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      setUnread((prev) =>
        Math.max(0, prev - ids.filter((id) => items.find((n) => n.id === id && !n.readAt)).length),
      );
      startTransition(async () => {
        await markNotificationsReadAction({ ids });
      });
    },
    [items],
  );

  const markAll = useCallback(() => {
    setItems((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    );
    setUnread(0);
    startTransition(async () => {
      await markNotificationsReadAction({ all: true });
    });
  }, []);

  const onItemClick = useCallback(
    (item: NotificationItem) => {
      if (!item.readAt) markRead([item.id]);
      setOpen(false);
      if (item.url) router.push(item.url);
    },
    [markRead, router],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"}
          className={cn(
            "text-text-2 ease-app hover:text-text-1 relative flex size-11 items-center justify-center transition-colors duration-150 md:size-9",
            className,
          )}
        >
          <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="bg-accent rounded-pill absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center px-1 text-[10px] leading-4 font-semibold text-white md:top-0.5 md:right-0.5"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="border-border bg-surface-2 rounded-card z-50 w-[min(92vw,22rem)] border shadow-[0_1px_3px_rgb(0_0_0/.06)] focus:outline-none"
        >
          <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-[14px] font-semibold">Уведомления</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-text-2 ease-app hover:text-text-1 flex items-center gap-1.5 text-[13px] transition-colors duration-150"
              >
                <CheckCheck size={14} strokeWidth={1.75} aria-hidden="true" />
                Прочитать все
              </button>
            )}
          </div>
          <div className="max-h-[min(70vh,26rem)] overflow-y-auto">
            {!loaded ? (
              <p className="text-text-3 px-4 py-6 text-center text-[13px]">Загрузка…</p>
            ) : items.length === 0 ? (
              <p className="text-text-2 px-4 py-8 text-center text-[13px]">
                Здесь появятся напоминания и новости платформы.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {items.map((item) => {
                  const unreadItem = !item.readAt;
                  const content = (
                    <>
                      <span className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "mt-1.5 size-1.5 shrink-0 rounded-full",
                            unreadItem ? "bg-accent" : "bg-transparent",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block text-[13px] leading-snug",
                              unreadItem ? "text-text-1 font-medium" : "text-text-2",
                            )}
                          >
                            {item.title}
                          </span>
                          {item.body && (
                            <span className="text-text-3 mt-0.5 block text-[12px] leading-snug">
                              {item.body}
                            </span>
                          )}
                          <span className="text-text-3 mt-1 block text-[11px]">
                            {relativeTime(item.createdAt)}
                          </span>
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {/* Always a button (keyboard-navigable, spec 14): marks read,
                          navigates when the notification has a url. */}
                      <button
                        type="button"
                        onClick={() => onItemClick(item)}
                        className="hover:bg-surface-1 ease-app block w-full px-4 py-2.5 text-left transition-colors duration-150"
                      >
                        {content}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
