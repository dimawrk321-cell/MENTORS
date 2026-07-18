"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { updateSettingsAction } from "@/lib/actions/settings";

const fieldClass =
  "rounded-control border-border text-text-1 ease-app hover:border-border-strong h-9 w-full border bg-transparent px-3 text-[14px] transition-colors duration-150";

const GATING_LABEL: Record<string, string> = {
  strict: "Строгий (уроки открываются по порядку)",
  recommended: "Рекомендованный (порядок подсвечен, всё открыто)",
  free: "Свободный (всё открыто)",
};

interface Props {
  renewalContact: string;
  accessRulesText: string;
  defaultCourseGating: "strict" | "recommended" | "free";
}

export function SettingsForm(initial: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [renewalContact, setRenewalContact] = useState(initial.renewalContact);
  const [accessRulesText, setAccessRulesText] = useState(initial.accessRulesText);
  const [gating, setGating] = useState(initial.defaultCourseGating);

  const submit = () => {
    start(async () => {
      const res = await updateSettingsAction({
        renewalContact,
        accessRulesText,
        defaultCourseGating: gating,
      });
      if (res.ok) {
        toast({ title: "Настройки сохранены", variant: "success" });
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="renewal" className="text-[14px] font-medium">
          Контакт продления
        </label>
        <p className="text-text-3 text-[12px]">
          Ссылка/контакт для продления доступа (tg, email). Пусто — берётся из env.
        </p>
        <Input
          id="renewal"
          value={renewalContact}
          onChange={(e) => setRenewalContact(e.target.value)}
          placeholder="https://t.me/…"
          maxLength={300}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="rules" className="text-[14px] font-medium">
          Текст правил доступа
        </label>
        <p className="text-text-3 text-[12px]">Показывается на странице согласия при инвайте.</p>
        <textarea
          id="rules"
          value={accessRulesText}
          onChange={(e) => setAccessRulesText(e.target.value)}
          rows={4}
          maxLength={5000}
          required
          className={`${fieldClass} h-auto py-2 leading-relaxed`}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="gating" className="text-[14px] font-medium">
          Гейтинг новых курсов по умолчанию
        </label>
        <select
          id="gating"
          value={gating}
          onChange={(e) => setGating(e.target.value as Props["defaultCourseGating"])}
          className={fieldClass}
        >
          {(["strict", "recommended", "free"] as const).map((g) => (
            <option key={g} value={g}>
              {GATING_LABEL[g]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Button type="submit" loading={pending}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}
