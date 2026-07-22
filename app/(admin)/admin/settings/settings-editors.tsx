"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  updateLevelTitlesAction,
  updateOperationalSettingsAction,
  updateXpMapAction,
} from "@/lib/actions/settings";
import { serializeLevelTitles, DEFAULT_LEVEL_TITLES } from "@/lib/services/level-titles";

// Editable XP map (spec 12.1/C1) + operational rules (C2). Both persist to
// app_settings; services read them live. «Сбросить к умолчанию» fills the code
// defaults into the form (a Save then removes the override in practice).

const numInputClass =
  "rounded-control border-border text-text-1 ease-app hover:border-border-strong h-9 w-24 border bg-transparent px-3 text-right text-[14px] tabular-nums transition-colors duration-150";

interface XpItem {
  key: string;
  label: string;
  value: number;
  default: number;
}

export function XpMapForm({ items }: { items: XpItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.key, String(i.value)])),
  );

  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));
  const resetDefaults = () =>
    setValues(Object.fromEntries(items.map((i) => [i.key, String(i.default)])));

  const submit = () => {
    const map: Record<string, number> = {};
    for (const i of items) {
      const n = Number(values[i.key]);
      if (!Number.isInteger(n) || n < 0 || n > 10000) {
        toast({ title: `«${i.label}»: нужно целое 0–10000`, variant: "danger" });
        return;
      }
      map[i.key] = n;
    }
    start(async () => {
      const res = await updateXpMapAction({ map });
      if (res.ok) {
        toast({ title: "XP-карта сохранена", variant: "success" });
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
      className="flex flex-col gap-4"
    >
      <div className="divide-border flex flex-col divide-y">
        {items.map((i) => (
          <div key={i.key} className="flex items-center justify-between gap-3 py-2">
            <label htmlFor={`xp-${i.key}`} className="text-[14px]">
              {i.label}
            </label>
            <input
              id={`xp-${i.key}`}
              type="number"
              min={0}
              max={10000}
              step={1}
              value={values[i.key] ?? ""}
              onChange={(e) => set(i.key, e.target.value)}
              className={numInputClass}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending}>
          Сохранить
        </Button>
        <Button type="button" variant="ghost" onClick={resetDefaults}>
          Сбросить к умолчанию
        </Button>
      </div>
    </form>
  );
}

/** Level-title ladder editor (spec 13.1/D7): one «<уровень> <титул>» per line. */
export function LevelTitlesForm({ initialText }: { initialText: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(initialText);

  const submit = () => {
    start(async () => {
      const res = await updateLevelTitlesAction({ text });
      if (res.ok) {
        toast({ title: "Титулы сохранены", variant: "success" });
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
      className="flex flex-col gap-4"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Титулы уровней"
        rows={12}
        className="rounded-control border-border text-text-1 ease-app hover:border-border-strong w-full border bg-transparent p-3 font-mono text-[13px] leading-relaxed transition-colors duration-150"
      />
      <p className="text-text-3 text-[12px]">
        По строке на титул: сначала минимальный уровень, затем название (например «5 Оверфиттер»).
        Титул действует до следующего порога.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending}>
          Сохранить
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setText(serializeLevelTitles(DEFAULT_LEVEL_TITLES))}
        >
          Сбросить к умолчанию
        </Button>
      </div>
    </form>
  );
}

interface OpsItem {
  key: string;
  label: string;
  unit: string;
  value: number;
  default: number;
  min: number;
  max: number;
}

export function OperationalSettingsForm({
  items,
  digest,
}: {
  items: OpsItem[];
  digest: { value: string; default: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.key, String(i.value)])),
  );
  const [digestTime, setDigestTime] = useState(digest.value);

  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));
  const resetDefaults = () => {
    setValues(Object.fromEntries(items.map((i) => [i.key, String(i.default)])));
    setDigestTime(digest.default);
  };

  const submit = () => {
    const out: Record<string, number> = {};
    for (const i of items) {
      const n = Number(values[i.key]);
      if (!Number.isInteger(n) || n < i.min || n > i.max) {
        toast({ title: `«${i.label}»: нужно целое ${i.min}–${i.max}`, variant: "danger" });
        return;
      }
      out[i.key] = n;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(digestTime)) {
      toast({ title: "Время дайджеста — в формате ЧЧ:ММ", variant: "danger" });
      return;
    }
    start(async () => {
      const res = await updateOperationalSettingsAction({ values: out, digestTime });
      if (res.ok) {
        toast({ title: "Правила сохранены", variant: "success" });
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
      className="flex flex-col gap-4"
    >
      <div className="divide-border flex flex-col divide-y">
        {items.map((i) => (
          <div key={i.key} className="flex items-center justify-between gap-3 py-2">
            <label htmlFor={`ops-${i.key}`} className="text-[14px]">
              {i.label}
              <span className="text-text-3 ml-1.5 text-[12px]">· {i.unit}</span>
            </label>
            <input
              id={`ops-${i.key}`}
              type="number"
              min={i.min}
              max={i.max}
              step={1}
              value={values[i.key] ?? ""}
              onChange={(e) => set(i.key, e.target.value)}
              className={numInputClass}
            />
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 py-2">
          <label htmlFor="ops-digest" className="text-[14px]">
            Дефолтное время дайджеста
            <span className="text-text-3 ml-1.5 text-[12px]">· ЧЧ:ММ</span>
          </label>
          <input
            id="ops-digest"
            type="time"
            value={digestTime}
            onChange={(e) => setDigestTime(e.target.value)}
            className={numInputClass}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending}>
          Сохранить
        </Button>
        <Button type="button" variant="ghost" onClick={resetDefaults}>
          Сбросить к умолчанию
        </Button>
      </div>
    </form>
  );
}
