"use client";

import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import { ActionButton } from "@/components/features/action-button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  blockStudentAction,
  impersonateAction,
  resetStudentSessionsAction,
  setSectionAccessAction,
  setStudentAdminLabelAction,
  unblockStudentAction,
} from "@/lib/actions/students";

// Thin client wrappers over the admin actions: confirm dialogs + toasts.

export function ImpersonateButton({ userId }: { userId: string }) {
  return (
    <ActionButton action={() => impersonateAction(userId)} variant="secondary" size="sm">
      <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
      Глазами ученика
    </ActionButton>
  );
}

export function BlockButton({ userId, name }: { userId: string; name: string }) {
  return (
    <ActionButton
      action={() => blockStudentAction(userId)}
      className="text-danger"
      successMessage="Ученик заблокирован"
      confirm={{
        title: `Заблокировать ${name}?`,
        description: "Все сессии будут завершены мгновенно, вход станет невозможен.",
        actionLabel: "Заблокировать",
      }}
    >
      Заблокировать
    </ActionButton>
  );
}

export function UnblockButton({ userId }: { userId: string }) {
  return (
    <ActionButton action={() => unblockStudentAction(userId)} successMessage="Ученик разблокирован">
      Разблокировать
    </ActionButton>
  );
}

export function ResetSessionsButton({ userId }: { userId: string }) {
  return (
    <ActionButton
      action={() => resetStudentSessionsAction(userId)}
      successMessage="Сессии и устройства сброшены"
      confirm={{
        title: "Сбросить сессии и устройства?",
        description: "Ученик будет разлогинен везде, список устройств очистится.",
        actionLabel: "Сбросить",
      }}
    >
      Сбросить сессии и устройства
    </ActionButton>
  );
}

/**
 * «Метка для админов» editor (13.4/4.1): shown under the name in the student card.
 * students.manage → inline edit; students.view → read-only (only when a label is
 * set). The student never sees this (admin_label is omitted from their session).
 */
export function AdminLabelEditor({
  userId,
  initialLabel,
  canManage,
}: {
  userId: string;
  initialLabel: string | null;
  canManage: boolean;
}) {
  const [label, setLabel] = useState(initialLabel ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [pending, startTransition] = useTransition();

  if (!canManage) {
    return label ? (
      <p className="text-text-3 mt-0.5 text-[13px]">
        Метка: <span className="text-text-2 italic">{label}</span>
      </p>
    ) : null;
  }

  function save(): void {
    startTransition(async () => {
      const res = await setStudentAdminLabelAction({ userId, adminLabel: draft });
      if (res.ok) {
        setLabel(res.data.adminLabel ?? "");
        setEditing(false);
        toast({ title: "Метка сохранена", variant: "success" });
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  }

  if (editing) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Метка для админов"
          aria-label="Метка для админов"
          maxLength={80}
          autoFocus
          className="max-w-xs"
        />
        <Button size="sm" loading={pending} onClick={save}>
          Сохранить
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(label);
            setEditing(false);
          }}
        >
          Отмена
        </Button>
      </div>
    );
  }

  return (
    <p className="text-text-3 mt-0.5 text-[13px]">
      <span>Метка для админов: </span>
      {label ? <span className="text-text-2 italic">{label}</span> : "—"}
      <button
        type="button"
        onClick={() => {
          setDraft(label);
          setEditing(true);
        }}
        className="text-accent ml-2 text-[12px] hover:underline"
      >
        {label ? "изменить" : "добавить"}
      </button>
    </p>
  );
}

/**
 * Per-student section access toggle (spec 7.9/7.10, 12.1/C3) — optimistic Switch.
 * Used for Библиотека / Резюме / Легенда.
 */
export function SectionAccessToggle({
  userId,
  section,
  enabled,
  label,
  onLabel,
  offLabel,
}: {
  userId: string;
  section: "library" | "resume" | "legend";
  enabled: boolean;
  label: string;
  onLabel: string;
  offLabel: string;
}) {
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function change(next: boolean): void {
    setOn(next); // optimistic (spec 15: safe optimistic updates)
    startTransition(async () => {
      const res = await setSectionAccessAction({ userId, section, enabled: next });
      if (res && !res.ok) {
        setOn(!next);
        toast({ title: res.error.message, variant: "danger" });
      } else if (res?.ok) {
        toast({ title: next ? onLabel : offLabel, variant: "success" });
      }
    });
  }

  // Row (design handoff «Карточка ученика»): label + persistent state hint on the
  // left, switch on the right, divider between rows.
  return (
    <label className="border-border flex items-center justify-between gap-4 border-b pb-2.5 text-[14px] last:border-b-0 last:pb-0">
      <span className="min-w-0">
        <span className="block">{label}</span>
        <span className="text-text-3 block text-[12px]">{on ? onLabel : offLabel}</span>
      </span>
      <Switch checked={on} onCheckedChange={change} disabled={pending} aria-label={label} />
    </label>
  );
}
