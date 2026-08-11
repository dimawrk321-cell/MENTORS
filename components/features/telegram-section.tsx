"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { ActionButton } from "@/components/features/action-button";
import { useViewOnly, VIEW_ONLY_TITLE } from "@/components/features/view-only";
import { toast } from "@/components/ui/toast";
import { connectTelegramAction, disconnectTelegramAction } from "@/lib/actions/profile";

// Telegram «Подключить»/«Отключить» block (spec 13.3 block 1.3). Connect issues a
// one-time code + t.me deep link (revealed once); the bot links the chat on /start.
// Reused by the student profile and the owner-only «Сигналы владельцу» settings card
// (the owner must be able to link to receive owner signals — walk 13.3 fix).

interface Props {
  linked: boolean;
  /** Copy shown when not yet linked (defaults to the student wording). */
  description?: string;
}

const DEFAULT_DESCRIPTION =
  "Подключи Telegram-бота, чтобы получать уведомления и смотреть прогресс командами.";

export function TelegramSection({ linked, description = DEFAULT_DESCRIPTION }: Props) {
  const router = useRouter();
  // «Глазами ученика»: чужой Telegram не привязываем (spec 7.2).
  const viewOnly = useViewOnly();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<{ deepLink: string; expiresMinutes: number } | null>(null);

  const connect = () =>
    start(async () => {
      const res = await connectTelegramAction();
      if (res.ok) {
        setLink(res.data);
        setOpen(true);
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });

  if (linked) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-2 text-[14px]">
          Telegram подключён — уведомления приходят в бота. Команды: /today, /help.
        </p>
        <ActionButton
          action={disconnectTelegramAction}
          successMessage="Telegram отключён"
          confirm={{
            title: "Отключить Telegram?",
            description: "Уведомления перестанут приходить в бота. Снова подключить можно здесь.",
            actionLabel: "Отключить",
          }}
        >
          Отключить
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-2 text-[14px]">{description}</p>
      <div>
        <Button
          onClick={connect}
          loading={pending}
          disabled={viewOnly}
          title={viewOnly ? VIEW_ONLY_TITLE : undefined}
        >
          <Send size={16} strokeWidth={1.75} aria-hidden="true" />
          Подключить Telegram
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Closing may mean the user linked in Telegram — refresh to reflect it.
          if (!next) router.refresh();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подключение Telegram</DialogTitle>
            <DialogDescription>
              Открой бота и нажми «Запустить» — аккаунт свяжется автоматически.
              {link ? ` Ссылка действует ${link.expiresMinutes} минут.` : ""}
            </DialogDescription>
          </DialogHeader>
          {link && (
            <div className="flex flex-col gap-3">
              <Button asChild>
                <a href={link.deepLink} target="_blank" rel="noopener noreferrer">
                  <Send size={16} strokeWidth={1.75} aria-hidden="true" />
                  Открыть бота в Telegram
                </a>
              </Button>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={link.deepLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="rounded-control border-border text-text-2 min-w-0 flex-1 border bg-transparent px-3 py-2 text-[13px]"
                />
                <CopyButton value={link.deepLink} label="Копировать" />
              </div>
              <p className="text-text-3 text-[12px]">
                После подключения бот пришлёт карточку дня. Закрой это окно и обнови страницу.
              </p>
            </div>
          )}
          <div className="mt-2 flex justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Готово
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
