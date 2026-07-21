"use client";

import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";

/**
 * One-time credential reveal (walk 12.4/A1): login + temporary password shown
 * once at creation/reset, with «Копировать пароль» and a ready-to-send
 * «Копировать сообщение». The plaintext lives only here — it is never re-fetchable.
 */
export function CredentialReveal({
  login,
  tempPassword,
  message,
}: {
  login: string;
  tempPassword: string;
  message: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-text-2 text-[13px]">Логин</span>
        <Input readOnly value={login} onFocus={(e) => e.target.select()} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-text-2 text-[13px]">Временный пароль</span>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={tempPassword}
            onFocus={(e) => e.target.select()}
            className="font-mono tracking-wide"
          />
          <CopyButton value={tempPassword} label="Копировать пароль" />
        </div>
      </div>
      <div className="rounded-control border-border bg-surface-2 border p-3">
        <p className="text-text-2 text-[13px] leading-relaxed">{message}</p>
      </div>
      <div>
        <CopyButton value={message} label="Копировать сообщение" />
      </div>
      <p className="text-text-3 text-[12px]">
        Пароль показывается один раз — сохрани или передай его сейчас. При первом входе платформа
        попросит придумать свой пароль.
      </p>
    </div>
  );
}
