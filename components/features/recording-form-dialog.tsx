"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { upsertRecordingAction } from "@/lib/actions/library";
import {
  COMPANY_TYPES,
  COMPANY_TYPE_LABEL,
  isChecklistComplete,
  RECORDING_CHECKLIST_ITEMS,
  RECORDING_DIRECTIONS,
  RECORDING_DIRECTION_LABEL,
  RECORDING_GRADES,
  RECORDING_GRADE_LABEL,
  RECORDING_OUTCOMES,
  RECORDING_OUTCOME_LABEL,
  RECORDING_STAGES,
  RECORDING_STAGE_LABEL,
} from "@/lib/constants";

interface Checklist {
  faces: boolean;
  voice: boolean;
  names: boolean;
  consent: boolean;
}

export interface RecordingFormValue {
  id: string;
  title: string;
  stage: string;
  direction: string;
  grade: string;
  outcome: string;
  companyType: string;
  durationMinutes: number;
  url: string;
  embedUrl: string | null;
  checklist: Checklist;
}

interface FormState {
  title: string;
  stage: string;
  direction: string;
  grade: string;
  outcome: string;
  companyType: string;
  duration: string;
  url: string;
  embedUrl: string;
  checklist: Checklist;
}

function initialState(recording?: RecordingFormValue): FormState {
  return {
    title: recording?.title ?? "",
    stage: recording?.stage ?? "screening",
    direction: recording?.direction ?? "ds",
    grade: recording?.grade ?? "middle",
    outcome: recording?.outcome ?? "unknown",
    companyType: recording?.companyType ?? "product",
    duration: recording ? String(recording.durationMinutes) : "60",
    url: recording?.url ?? "",
    embedUrl: recording?.embedUrl ?? "",
    checklist: recording?.checklist ?? {
      faces: false,
      voice: false,
      names: false,
      consent: false,
    },
  };
}

function EnumField({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  labels: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-text-2 text-[13px]">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labels[option] ?? option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Recording create/edit (spec 7.9). «Опубликовать» is disabled until all four
 * checklist items are ticked — the anonymization gate is built into the UI (the
 * server enforces it as well).
 */
export function RecordingFormDialog({ recording }: { recording?: RecordingFormValue }) {
  const editing = !!recording;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => initialState(recording));
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onOpenChange(next: boolean): void {
    setOpen(next);
    // Reset a fresh create dialog after each use so it never carries prior input.
    if (!next && !editing) setForm(initialState());
  }

  function submit(status: "draft" | "published"): void {
    startTransition(async () => {
      const res = await upsertRecordingAction({
        id: recording?.id ?? null,
        title: form.title,
        stage: form.stage,
        direction: form.direction,
        grade: form.grade,
        outcome: form.outcome,
        companyType: form.companyType,
        durationMinutes: Number(form.duration),
        url: form.url,
        embedUrl: form.embedUrl,
        checklist: form.checklist,
        status,
      });
      if (!res) return;
      if (res.ok) {
        toast({
          title:
            status === "published"
              ? "Запись опубликована"
              : editing
                ? "Изменения сохранены"
                : "Черновик создан",
          variant: "success",
        });
        onOpenChange(false);
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  }

  const checklistComplete = isChecklistComplete(form.checklist);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm" aria-label="Редактировать запись">
            <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
            Изменить
          </Button>
        ) : (
          <Button size="sm">
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            Создать запись
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Редактирование записи" : "Новая запись"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rec-title" className="text-text-2 text-[13px]">
              Название (внутреннее, ученику не показывается)
            </label>
            <Input
              id="rec-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="напр. NLP middle — оффер"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <EnumField
              label="Этап"
              value={form.stage}
              onChange={(stage) => setForm({ ...form, stage })}
              options={RECORDING_STAGES}
              labels={RECORDING_STAGE_LABEL}
            />
            <EnumField
              label="Направление"
              value={form.direction}
              onChange={(direction) => setForm({ ...form, direction })}
              options={RECORDING_DIRECTIONS}
              labels={RECORDING_DIRECTION_LABEL}
            />
            <EnumField
              label="Грейд"
              value={form.grade}
              onChange={(grade) => setForm({ ...form, grade })}
              options={RECORDING_GRADES}
              labels={RECORDING_GRADE_LABEL}
            />
            <EnumField
              label="Исход"
              value={form.outcome}
              onChange={(outcome) => setForm({ ...form, outcome })}
              options={RECORDING_OUTCOMES}
              labels={RECORDING_OUTCOME_LABEL}
            />
            <EnumField
              label="Тип компании"
              value={form.companyType}
              onChange={(companyType) => setForm({ ...form, companyType })}
              options={COMPANY_TYPES}
              labels={COMPANY_TYPE_LABEL}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rec-duration" className="text-text-2 text-[13px]">
                Длительность (мин)
              </label>
              <Input
                id="rec-duration"
                type="number"
                min={1}
                max={600}
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="rec-url" className="text-text-2 text-[13px]">
              Ссылка на запись (Я.Диск)
            </label>
            <Input
              id="rec-url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://disk.yandex.ru/i/…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rec-embed" className="text-text-2 text-[13px]">
              Ссылка для встраивания плеера (необязательно)
            </label>
            <Input
              id="rec-embed"
              value={form.embedUrl}
              onChange={(e) => setForm({ ...form, embedUrl: e.target.value })}
              placeholder="https://disk.yandex.ru/embed/…"
            />
          </div>

          {/* Чеклист анонимизации — гейт публикации (spec 7.9). */}
          <fieldset className="rounded-control border-border flex flex-col gap-2.5 border p-3">
            <legend className="text-text-2 px-1 text-[13px]">Чеклист анонимизации</legend>
            {RECORDING_CHECKLIST_ITEMS.map((item) => (
              <label key={item.key} className="flex items-center gap-2.5 text-[14px]">
                <Checkbox
                  checked={form.checklist[item.key]}
                  onCheckedChange={(checked) =>
                    setForm({
                      ...form,
                      checklist: { ...form.checklist, [item.key]: checked === true },
                    })
                  }
                />
                {item.label}
              </label>
            ))}
            {!checklistComplete && (
              <p className="text-text-3 text-[12px]">
                Отметь все четыре пункта, чтобы стала доступна публикация.
              </p>
            )}
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="secondary" loading={pending} onClick={() => submit("draft")}>
            Сохранить черновик
          </Button>
          <Button
            loading={pending}
            disabled={!checklistComplete}
            title={checklistComplete ? undefined : "Отметь все пункты чеклиста"}
            onClick={() => submit("published")}
          >
            Опубликовать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
