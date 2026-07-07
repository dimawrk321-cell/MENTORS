"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Роль вопроса в уроке (spec 7.4 + changelog этапа 3): is_key и in_quiz
// взаимоисключающие — ключевой вопрос показывает эталон в блоке урока и не
// может одновременно скрывать его в квизе.

export type QuestionLinkRole = "key" | "quiz" | "plain";

export function roleFromFlags(isKey: boolean, inQuiz: boolean): QuestionLinkRole {
  if (isKey) return "key";
  if (inQuiz) return "quiz";
  return "plain";
}

export function flagsFromRole(role: QuestionLinkRole): { isKey: boolean; inQuiz: boolean } {
  return { isKey: role === "key", inQuiz: role === "quiz" };
}

export const ROLE_LABEL: Record<QuestionLinkRole, string> = {
  key: "Ключевой",
  quiz: "В квизе",
  plain: "Просто привязан",
};

export function QuestionRoleSelect({
  value,
  onChange,
  ariaLabel = "Роль вопроса в уроке",
  className,
}: {
  value: QuestionLinkRole;
  onChange: (role: QuestionLinkRole) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(role) => onChange(role as QuestionLinkRole)}>
      <SelectTrigger className={className ?? "h-8 w-44 text-[13px]"} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(ROLE_LABEL) as QuestionLinkRole[]).map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABEL[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
