import { z } from "zod";
import {
  addDays,
  dateOnlyUtc,
  isoWeekday,
  localDateStr,
  localDaysBetween,
  zonedDayUtcRange,
} from "@/lib/utils/dates";

const text = z.string().max(2000);
export const studyFieldsSchema = z
  .object({
    topic: z.string().max(240),
    plannedLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    goal: text,
    phoneAway: z.boolean(),
    oneMaterial: z.boolean(),
    timerSet: z.boolean(),
    firstStepClear: z.boolean(),
    blockPlan: text,
    plannedBlocks: z.number().int().min(1).max(24),
    blockMinutes: z.number().int().min(1).max(180),
    startedOnTime: z.boolean().nullable(),
    completedBlocks: z.number().int().min(0).max(24).nullable(),
    distractions: z.number().int().min(0).max(999).nullable(),
    explain: z.enum(["yes", "partial", "no"]).nullable(),
    thoughts: z.tuple([text, text, text]),
    gaps: text,
    nextAction: text,
  })
  .strict();
export type StudyFields = z.infer<typeof studyFieldsSchema>;
export type StudyStatus = "draft" | "running" | "reflection" | "completed" | "abandoned";
export interface RepetitionSnapshot {
  cardId: string;
  questionId: string;
  step: number;
  nextReviewAt: string;
  suspended: boolean;
}
export const repetitionSnapshotSchema = z
  .array(
    z.object({
      cardId: z.string(),
      questionId: z.string(),
      step: z.number().int().min(0),
      nextReviewAt: z.string(),
      suspended: z.boolean(),
    }),
  )
  .max(200);
export interface StudyCard {
  id: string;
  userId: string;
  courseId: string | null;
  lessonId: string | null;
  courseTitle: string | null;
  lessonTitle: string | null;
  timezone: string;
  status: StudyStatus;
  version: number;
  fields: StudyFields;
  repetitions: RepetitionSnapshot[];
  plannedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
export const statusLabels: Record<StudyStatus, string> = {
  draft: "Черновик",
  running: "Идёт занятие",
  reflection: "Ожидает рефлексии",
  completed: "Завершено",
  abandoned: "Прервано",
};
export const explainLabels = { yes: "Да", partial: "Частично", no: "Нет" };
export function newStudyFields(topic: string, plannedLocal: string): StudyFields {
  return {
    topic,
    plannedLocal,
    goal: "",
    phoneAway: false,
    oneMaterial: false,
    timerSet: false,
    firstStepClear: false,
    blockPlan: "",
    plannedBlocks: 1,
    blockMinutes: 25,
    startedOnTime: null,
    completedBlocks: null,
    distractions: null,
    explain: null,
    thoughts: ["", "", ""],
    gaps: "",
    nextAction: "",
  };
}
export function elapsedMinutes(card: StudyCard): number | null {
  return card.startedAt && card.endedAt
    ? Math.max(0, Math.round((Date.parse(card.endedAt) - Date.parse(card.startedAt)) / 60000))
    : null;
}
export function studyWeek(now: Date, timezone: string, week?: string) {
  const day = week ?? localDateStr(now, timezone);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day
  )
    throw new Error("Некорректная неделя");
  const monday = addDays(dateOnlyUtc(day), 1 - isoWeekday(day))
    .toISOString()
    .slice(0, 10);
  const next = addDays(dateOnlyUtc(monday), 7).toISOString().slice(0, 10);
  return {
    key: monday,
    timezone,
    start: zonedDayUtcRange(monday, timezone).start,
    end: zonedDayUtcRange(next, timezone).start,
  };
}
export function normalizeStudyText(value: string) {
  return value
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function grouped(cards: StudyCard[], values: (c: StudyCard) => string[]) {
  const groups = new Map<string, { text: string; sessionIds: string[] }>();
  for (const card of cards)
    for (const value of values(card)) {
      const key = normalizeStudyText(value);
      if (!key) continue;
      const group = groups.get(key) ?? { text: value.trim(), sessionIds: [] };
      if (!group.sessionIds.includes(card.id)) group.sessionIds.push(card.id);
      groups.set(key, group);
    }
  return [...groups.values()].sort((a, b) => b.sessionIds.length - a.sessionIds.length);
}
export function summarizeStudyWeek(cards: StudyCard[], now: Date, timezone: string, week?: string) {
  const range = studyWeek(now, timezone, week);
  // Assign completed sessions by actual stop, not by delayed reflection or later edits.
  const inside = (time: string | null) =>
    time !== null && Date.parse(time) >= +range.start && Date.parse(time) < +range.end;
  const completed = cards.filter((c) => c.status === "completed" && inside(c.endedAt));
  const minutes = completed.map(elapsedMinutes).filter((n): n is number => n !== null);
  const answered = completed.filter((c) => c.fields.distractions !== null);
  const totalMinutes = minutes.reduce((a, b) => a + b, 0);
  return {
    week: range.key,
    timezone,
    count: completed.length,
    unfinished: cards.filter(
      (c) => !["completed", "abandoned"].includes(c.status) && inside(c.startedAt ?? c.createdAt),
    ).length,
    totalMinutes,
    averageMinutes: minutes.length ? Math.round(totalMinutes / minutes.length) : null,
    explain: {
      yes: completed.filter((c) => c.fields.explain === "yes").length,
      partial: completed.filter((c) => c.fields.explain === "partial").length,
      no: completed.filter((c) => c.fields.explain === "no").length,
    },
    onTime: completed.filter((c) => c.fields.startedOnTime === true).length,
    late: completed.filter((c) => c.fields.startedOnTime === false).length,
    distractions: answered.reduce((sum, c) => sum + (c.fields.distractions ?? 0), 0),
    averageDistractions: answered.length
      ? Math.round(
          (answered.reduce((s, c) => s + (c.fields.distractions ?? 0), 0) / answered.length) * 10,
        ) / 10
      : null,
    topics: grouped(completed, (c) => [c.fields.topic]),
    gaps: grouped(completed, (c) => c.fields.gaps.split(/[\n;]/)).filter(
      (g) => g.sessionIds.length >= 2,
    ),
    nextActions: grouped(completed, (c) => [c.fields.nextAction]),
    sessionIds: completed.map((c) => c.id),
  };
}
export interface StudyFlag {
  type: string;
  severity: "red" | "yellow";
  reason: string;
  sessionIds: string[];
}
export function studyFlags(
  cards: StudyCard[],
  now: Date,
  timezone: string,
  lastActivity: Date,
): StudyFlag[] {
  const done = cards
    .filter((c) => c.status === "completed")
    .sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!) || b.id.localeCompare(a.id));
  const flags: StudyFlag[] = [];
  if (done.length >= 3 && done.slice(0, 3).every((c) => c.fields.explain === "no"))
    flags.push({
      type: "explain",
      severity: "red",
      reason: "3 занятия подряд: не могу объяснить без конспекта",
      sessionIds: done.slice(0, 3).map((c) => c.id),
    });
  const distractionRun = done.findIndex((c) => (c.fields.distractions ?? -1) < 3);
  const run = distractionRun < 0 ? done.length : distractionRun;
  if (run >= 3)
    flags.push({
      type: "distractions",
      severity: run >= 4 ? "red" : "yellow",
      reason: `${run} занятий подряд с 3+ отвлечениями`,
      sessionIds: done.slice(0, run).map((c) => c.id),
    });
  const recent = done.filter((c) => localDaysBetween(new Date(c.endedAt!), now, timezone) < 28);
  for (const gap of grouped(recent, (c) => c.fields.gaps.split(/[\n;]/)).filter(
    (g) => g.sessionIds.length >= 3,
  ))
    flags.push({
      type: `gap:${normalizeStudyText(gap.text)}`,
      severity: "yellow",
      reason: `Повторяющийся пробел: ${gap.text}`,
      sessionIds: gap.sessionIds,
    });
  const latest = Math.max(
    +lastActivity,
    ...cards.flatMap((c) =>
      [c.startedAt, c.endedAt].filter((t): t is string => t !== null).map(Date.parse),
    ),
  );
  const days = localDaysBetween(new Date(latest), now, timezone);
  if (days >= 5)
    flags.push({
      type: "inactive",
      severity: "yellow",
      reason: `${days} дней без учебных сессий и другой учебной активности`,
      sessionIds: done.slice(0, 1).map((c) => c.id),
    });
  return flags;
}
