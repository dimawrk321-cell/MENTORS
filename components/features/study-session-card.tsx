"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { BookOpenCheck, ChevronDown, ChevronUp, Clock3, History } from "lucide-react";
import { createStudySessionAction, updateStudySessionAction } from "@/lib/actions/study-sessions";
import {
  elapsedMinutes,
  explainLabels,
  formatStudyTimer,
  statusLabels,
  studySessionTimer,
  type StudyCard,
  type StudyFields,
} from "@/lib/utils/study-session-summary";
import { useViewOnly, ViewOnlyNote } from "@/components/features/view-only";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const textareaClass =
  "border-border rounded-control text-text-1 placeholder:text-text-3 min-h-20 w-full resize-y border bg-transparent px-3 py-2 text-[14px]";
const labelClass = "flex flex-col gap-1.5 text-[13px] font-medium";
function set<K extends keyof StudyFields>(fields: StudyFields, key: K, value: StudyFields[K]) {
  return { ...fields, [key]: value };
}

export function StudySessionCard({
  initial,
  lessonId = null,
  compact = false,
}: {
  initial: StudyCard | null;
  lessonId?: string | null;
  compact?: boolean;
}) {
  const [card, setCard] = useState(initial);
  const [fields, setFields] = useState(initial?.fields ?? null);
  const [collapsed, setCollapsed] = useState(initial?.status === "running");
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const viewOnly = useViewOnly();
  useEffect(() => {
    setCard(initial);
    setFields(initial?.fields ?? null);
    setCollapsed(initial?.status === "running");
  }, [initial]);
  const runningStartedAt = card?.status === "running" ? card.startedAt : null;
  useEffect(() => {
    if (!runningStartedAt) {
      setNowMs(null);
      return;
    }
    const tick = () => setNowMs(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [runningStartedAt]);
  const create = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await createStudySessionAction({ lessonId });
      if (!result.ok) return setMessage(result.error.message);
      setCard(result.data);
      setFields(result.data.fields);
    });
  const command = (operation: "save" | "start" | "stop" | "complete" | "abandon") => {
    if (!card || !fields) return;
    startTransition(async () => {
      setMessage(null);
      const result = await updateStudySessionAction({
        id: card.id,
        version: card.version,
        operation,
        fields,
      });
      if (!result.ok) return setMessage(result.error.message);
      setCard(result.data);
      setFields(result.data.fields);
      if (operation === "start") setCollapsed(true);
      if (operation === "stop") setCollapsed(false);
      setMessage(operation === "save" ? "Черновик сохранён" : null);
    });
  };
  if (!card || !fields)
    return (
      <Card className={compact ? "my-5" : undefined}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Карточка занятия</p>
            <p className="text-text-2 text-[13px]">
              Сформулируй цель до старта — это займёт минуту.
            </p>
          </div>
          <Button onClick={create} loading={pending} disabled={viewOnly}>
            <BookOpenCheck size={16} />
            Начать учебную сессию
          </Button>
          {viewOnly && <ViewOnlyNote className="w-full" />}
          {message && (
            <p role="alert" className="text-danger w-full text-[13px]">
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    );
  const planning = card.status === "draft";
  const reflection = card.status === "reflection" || card.status === "completed";
  const timer =
    card.status === "running" && card.startedAt
      ? studySessionTimer(
          card.startedAt,
          fields.plannedBlocks,
          fields.blockMinutes,
          nowMs ?? Date.parse(card.startedAt),
        )
      : null;
  return (
    <Card id={`study-session-${card.id}`} className={compact ? "my-5" : undefined}>
      <CardHeader className={collapsed ? "p-4" : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle>Карточка занятия</CardTitle>
            <CardDescription className="mt-1 truncate">
              {card.courseTitle ? `${card.courseTitle} · ` : ""}
              {card.lessonTitle ?? "Самостоятельное занятие"} · {card.timezone}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {timer && (
              <div
                role="timer"
                aria-label={
                  timer.overtime
                    ? `Плановое время истекло ${formatStudyTimer(timer.overtimeSeconds)} назад`
                    : `До конца планового времени ${formatStudyTimer(timer.remainingSeconds)}`
                }
                className={`rounded-control flex h-9 items-center gap-2 border px-3 text-[13px] tabular-nums ${
                  timer.overtime
                    ? "border-warning/35 bg-warning/8 text-warning"
                    : "border-accent/30 bg-accent/10 text-accent"
                }`}
              >
                <Clock3 size={15} aria-hidden="true" />
                <span className="font-semibold">
                  {timer.overtime
                    ? `План +${formatStudyTimer(timer.overtimeSeconds)}`
                    : `Осталось ${formatStudyTimer(timer.remainingSeconds)}`}
                </span>
                <span className="text-text-2 hidden font-normal sm:inline">
                  из {fields.plannedBlocks * fields.blockMinutes} мин
                </span>
              </div>
            )}
            <Badge variant={card.status === "completed" ? "success" : "accent"}>
              {statusLabels[card.status]}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={!collapsed}
              aria-controls={`study-session-body-${card.id}`}
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              {collapsed ? "Развернуть" : "Свернуть"}
            </Button>
          </div>
        </div>
        {collapsed && card.status === "running" && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-text-2 truncate text-[13px]">
              {fields.topic || card.lessonTitle || "Учебная сессия"} · {fields.plannedBlocks} ×{" "}
              {fields.blockMinutes} мин
            </p>
            <Button size="sm" onClick={() => command("stop")} loading={pending} disabled={viewOnly}>
              Завершить занятие
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent
        id={`study-session-body-${card.id}`}
        hidden={collapsed}
        className={collapsed ? "hidden" : "flex flex-col gap-4"}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Тема
            <Input
              value={fields.topic}
              disabled={!planning || viewOnly}
              onChange={(e) => setFields(set(fields, "topic", e.target.value))}
            />
          </label>
          <label className={labelClass}>
            Дата и время
            <Input
              type="datetime-local"
              value={fields.plannedLocal}
              disabled={!planning || viewOnly}
              onChange={(e) => setFields(set(fields, "plannedLocal", e.target.value))}
            />
          </label>
        </div>
        <label className={labelClass}>
          После занятия я смогу…
          <textarea
            className={textareaClass}
            value={fields.goal}
            disabled={!planning || viewOnly}
            onChange={(e) => setFields(set(fields, "goal", e.target.value))}
          />
        </label>
        <fieldset disabled={!planning || viewOnly} className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-[13px] font-medium">Перед стартом</legend>
          {(
            [
              ["phoneAway", "Телефон убран"],
              ["oneMaterial", "Открыт один материал"],
              ["timerSet", "Поставлен таймер"],
              ["firstStepClear", "Первый шаг понятен"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-center gap-2 text-[14px]">
              <Checkbox
                checked={fields[key]}
                onCheckedChange={(v) => setFields(set(fields, key, v === true))}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className={labelClass}>
          План блоков
          <textarea
            className={textareaClass}
            value={fields.blockPlan}
            disabled={!planning || viewOnly}
            placeholder="Например: теория → практика → повторение"
            onChange={(e) => setFields(set(fields, "blockPlan", e.target.value))}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Блоков
            <Input
              type="number"
              min={1}
              max={24}
              value={fields.plannedBlocks}
              disabled={!planning || viewOnly}
              onChange={(e) => setFields(set(fields, "plannedBlocks", Number(e.target.value)))}
            />
          </label>
          <label className={labelClass}>
            Минут в блоке
            <Input
              type="number"
              min={1}
              max={180}
              value={fields.blockMinutes}
              disabled={!planning || viewOnly}
              onChange={(e) => setFields(set(fields, "blockMinutes", Number(e.target.value)))}
            />
          </label>
        </div>
        {card.status === "running" && (
          <p className="text-text-2 text-[13px]">
            Плановый таймер остаётся в шапке карточки, даже когда она свёрнута.
          </p>
        )}
        {reflection && <Reflection fields={fields} disabled={viewOnly} onChange={setFields} />}
        {card.status === "completed" && <Repetitions card={card} />}
        {message && (
          <p
            role="status"
            className={
              message === "Черновик сохранён"
                ? "text-success text-[13px]"
                : "text-danger text-[13px]"
            }
          >
            {message}
          </p>
        )}
        {viewOnly && <ViewOnlyNote />}
        <div className="flex flex-wrap gap-2">
          {planning && (
            <>
              <Button
                variant="secondary"
                onClick={() => command("save")}
                loading={pending}
                disabled={viewOnly}
              >
                Сохранить черновик
              </Button>
              <Button onClick={() => command("start")} loading={pending} disabled={viewOnly}>
                Начать занятие
              </Button>
            </>
          )}
          {card.status === "running" && (
            <Button onClick={() => command("stop")} loading={pending} disabled={viewOnly}>
              Завершить занятие
            </Button>
          )}
          {card.status === "reflection" && (
            <>
              <Button
                variant="secondary"
                onClick={() => command("save")}
                loading={pending}
                disabled={viewOnly}
              >
                Сохранить черновик
              </Button>
              <Button onClick={() => command("complete")} loading={pending} disabled={viewOnly}>
                Потратить 60 секунд и сохранить
              </Button>
            </>
          )}
          {card.status === "completed" && (
            <Button onClick={() => command("save")} loading={pending} disabled={viewOnly}>
              Сохранить исправления
            </Button>
          )}
          {!["completed", "abandoned"].includes(card.status) && (
            <Button
              variant="ghost"
              onClick={() => command("abandon")}
              loading={pending}
              disabled={viewOnly}
            >
              Прервать
            </Button>
          )}
          {!compact && (
            <Button asChild variant="ghost">
              <Link href="/study-sessions">
                <History size={16} />
                История
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Reflection({
  fields,
  disabled,
  onChange,
}: {
  fields: StudyFields;
  disabled: boolean;
  onChange: (f: StudyFields) => void;
}) {
  return (
    <div className="border-border flex flex-col gap-4 border-t pt-4">
      <p className="font-medium">Короткая рефлексия</p>
      <Radio
        label="Начал вовремя"
        value={fields.startedOnTime === null ? "" : String(fields.startedOnTime)}
        options={[
          ["true", "Да"],
          ["false", "Нет"],
        ]}
        disabled={disabled}
        onChange={(v) => onChange(set(fields, "startedOnTime", v === "true"))}
      />
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Завершено блоков
          <Input
            type="number"
            min={0}
            max={fields.plannedBlocks}
            value={fields.completedBlocks ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onChange(
                set(
                  fields,
                  "completedBlocks",
                  e.target.value === "" ? null : Number(e.target.value),
                ),
              )
            }
          />
        </label>
        <label className={labelClass}>
          Сколько раз отвлекался
          <Input
            type="number"
            min={0}
            max={999}
            value={fields.distractions ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onChange(
                set(fields, "distractions", e.target.value === "" ? null : Number(e.target.value)),
              )
            }
          />
        </label>
      </div>
      <Radio
        label="Могу объяснить без конспекта"
        value={fields.explain ?? ""}
        options={[
          ["yes", "Да"],
          ["partial", "Частично"],
          ["no", "Нет"],
        ]}
        disabled={disabled}
        onChange={(v) => onChange(set(fields, "explain", v as StudyFields["explain"]))}
      />
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-1 text-[13px] font-medium">Три главные мысли</legend>
        {fields.thoughts.map((thought, i) => (
          <Input
            key={i}
            value={thought}
            placeholder={`${i + 1}.`}
            onChange={(e) => {
              const thoughts = [...fields.thoughts] as StudyFields["thoughts"];
              thoughts[i] = e.target.value;
              onChange(set(fields, "thoughts", thoughts));
            }}
          />
        ))}
      </fieldset>
      <label className={labelClass}>
        Что именно не понял
        <textarea
          className={textareaClass}
          value={fields.gaps}
          disabled={disabled}
          placeholder="Можно оставить пустым"
          onChange={(e) => onChange(set(fields, "gaps", e.target.value))}
        />
      </label>
      <label className={labelClass}>
        Следующее действие
        <Input
          value={fields.nextAction}
          disabled={disabled}
          onChange={(e) => onChange(set(fields, "nextAction", e.target.value))}
        />
      </label>
    </div>
  );
}
function Radio({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: string[][];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-[13px] font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <label
            key={v}
            className={`rounded-control border px-3 py-2 text-[14px] ${value === v ? "border-accent bg-accent/12" : "border-border"}`}
          >
            <input
              className="sr-only"
              type="radio"
              checked={value === v}
              onChange={() => onChange(v!)}
            />
            {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function Repetitions({ card }: { card: StudyCard }) {
  return (
    <div className="border-border border-t pt-4">
      <p className="font-medium">Повторения</p>
      {card.repetitions.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {card.repetitions.map((r) => (
            <Badge key={r.cardId}>
              R{r.step} · {r.nextReviewAt}
              {r.suspended ? " · на паузе" : ""}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-text-2 mt-1 text-[13px]">Связанных карточек SRS пока нет.</p>
      )}
    </div>
  );
}
export function StudyCardDetails({
  card,
  editable = false,
}: {
  card: StudyCard;
  editable?: boolean;
}) {
  const f = card.fields;
  const shownAt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: card.timezone,
        }).format(new Date(iso))
      : "—";
  return (
    <details id={`study-session-${card.id}`} className="border-border rounded-control border p-4">
      <summary className="cursor-pointer font-medium">
        {f.topic || card.lessonTitle || "Без темы"} · {statusLabels[card.status]}
      </summary>
      <div className="text-text-2 mt-3 grid gap-2 text-[13px]">
        <p>
          {card.courseTitle ? `${card.courseTitle} · ` : ""}
          {card.lessonTitle ?? "Самостоятельное занятие"}
        </p>
        <p>
          <b className="text-text-1">План:</b> {f.plannedLocal} · {card.timezone} ·{" "}
          {f.blockPlan || "—"} · {f.plannedBlocks} × {f.blockMinutes} мин
        </p>
        <p>
          <b className="text-text-1">Фактическое время:</b> {shownAt(card.startedAt)} —{" "}
          {shownAt(card.endedAt)}
          {elapsedMinutes(card) !== null ? ` · ${elapsedMinutes(card)} мин` : ""}
        </p>
        <p>
          <b className="text-text-1">После занятия смогу:</b> {f.goal || "—"}
        </p>
        <p>
          <b className="text-text-1">Перед стартом:</b> телефон{" "}
          {f.phoneAway ? "убран" : "не отмечен"}, один материал {f.oneMaterial ? "да" : "нет"},
          таймер {f.timerSet ? "да" : "нет"}, первый шаг{" "}
          {f.firstStepClear ? "понятен" : "не отмечен"}
        </p>
        {card.status === "completed" && (
          <>
            <p>
              <b className="text-text-1">Факт:</b> {f.completedBlocks}/{f.plannedBlocks} блоков,
              отвлечений: {f.distractions}, вовремя: {f.startedOnTime ? "да" : "нет"}, объясню:{" "}
              {f.explain ? explainLabels[f.explain] : "—"}
            </p>
            <p>
              <b className="text-text-1">Три мысли:</b>{" "}
              {f.thoughts.filter(Boolean).join(" · ") || "—"}
            </p>
            <p>
              <b className="text-text-1">Не понял:</b> {f.gaps || "нет отмеченных пробелов"}
            </p>
            <p>
              <b className="text-text-1">Следующий шаг:</b> {f.nextAction || "—"}
            </p>
            <Repetitions card={card} />
            {editable && (
              <Link
                href={`/study-sessions?edit=${card.id}#study-session-${card.id}`}
                className="text-accent w-fit underline"
              >
                Исправить рефлексию
              </Link>
            )}
          </>
        )}
      </div>
    </details>
  );
}
