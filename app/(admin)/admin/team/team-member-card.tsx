"use client";

import { useState, useTransition } from "react";
import type { UserStatus } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { ActionButton } from "@/components/features/action-button";
import { UserStatusBadge } from "@/components/features/user-status-badge";
import { PERMISSIONS, ROLE_PRESETS, type Permission, type TeamRole } from "@/lib/constants";
import { categoryColorVar, categoryTextColor } from "@/lib/utils/category-color";
import {
  blockTeamMemberAction,
  setTeamInterviewerAction,
  setTeamPermissionsAction,
  setTeamRoleAction,
  unblockTeamMemberAction,
} from "@/lib/actions/team";
import { ResetMemberPasswordDialog } from "./reset-member-password-dialog";

export interface TeamMemberView {
  id: string;
  name: string;
  email: string;
  role: "mentor" | "admin" | "owner";
  isInterviewer: boolean;
  status: UserStatus;
  /** Permission override (null = pure role preset). */
  override: Permission[] | null;
  avatarColor: number;
  lastSeenText: string;
}

const ROLE_LABEL: Record<string, string> = {
  mentor: "Ментор",
  admin: "Админ",
  owner: "Владелец",
};

const fieldClass =
  "rounded-control border-border text-text-1 ease-app hover:border-border-strong h-9 w-full max-w-[200px] border bg-transparent px-3 text-[14px] transition-colors duration-150";

function Avatar({ color, label }: { color: number; label: string }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-pill flex size-10 shrink-0 items-center justify-center text-[15px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${categoryColorVar(color)} 15%, transparent)`,
        color: categoryTextColor(color),
      }}
    >
      {label.charAt(0).toUpperCase()}
    </div>
  );
}

export function TeamMemberCard({ member }: { member: TeamMemberView }) {
  const isOwner = member.role === "owner";
  const [pending, startTransition] = useTransition();
  const [interviewer, setInterviewer] = useState(member.isInterviewer);
  const [useOverride, setUseOverride] = useState(member.override !== null);
  const [perms, setPerms] = useState<Set<Permission>>(
    () => new Set(member.override ?? ROLE_PRESETS[member.role as TeamRole]),
  );

  function run(
    promise: Promise<{ ok: boolean; error?: { message: string } }>,
    okMsg: string,
  ): void {
    startTransition(async () => {
      const res = await promise;
      if (res.ok) toast({ title: okMsg, variant: "success" });
      else toast({ title: res.error?.message ?? "Не удалось", variant: "danger" });
    });
  }

  function changeInterviewer(next: boolean): void {
    setInterviewer(next); // optimistic
    startTransition(async () => {
      const res = await setTeamInterviewerAction({ userId: member.id, isInterviewer: next });
      if (!res.ok) {
        setInterviewer(!next);
        toast({ title: res.error.message, variant: "danger" });
      } else {
        toast({
          title: next ? "Кабинет интервьюера открыт" : "Кабинет интервьюера закрыт",
          variant: "success",
        });
      }
    });
  }

  function toggleOverride(next: boolean): void {
    if (next) {
      // Enter override mode seeded with the current effective set — persisted on save.
      setPerms(new Set(member.override ?? ROLE_PRESETS[member.role as TeamRole]));
      setUseOverride(true);
    } else {
      // Back to the role preset.
      setUseOverride(false);
      run(
        setTeamPermissionsAction({ userId: member.id, permissions: null }),
        "Права по пресету роли",
      );
    }
  }

  function togglePerm(key: Permission, checked: boolean): void {
    setPerms((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  const effective = useOverride ? perms : new Set(ROLE_PRESETS[member.role as TeamRole]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar color={member.avatarColor} label={member.name || member.email} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{member.name || member.email}</span>
                <Badge variant={isOwner ? "accent" : "default"}>{ROLE_LABEL[member.role]}</Badge>
                {member.isInterviewer && <Badge variant="default">интервьюер</Badge>}
                <UserStatusBadge status={member.status} />
              </div>
              <p className="text-text-3 text-[13px]">
                {member.email} · был активен {member.lastSeenText}
              </p>
            </div>
          </div>
        </div>

        {isOwner ? (
          <p className="text-text-3 text-[13px]">
            Владелец платформы — роль, права и доступ не редактируются.
          </p>
        ) : (
          <div className="border-border flex flex-col gap-4 border-t pt-4">
            {/* Role + interviewer */}
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <label className="flex items-center gap-2.5 text-[14px]">
                <span className="text-text-2">Роль</span>
                <select
                  aria-label="Роль участника"
                  defaultValue={member.role}
                  disabled={pending}
                  onChange={(e) =>
                    run(
                      setTeamRoleAction({ userId: member.id, role: e.target.value as TeamRole }),
                      "Роль обновлена",
                    )
                  }
                  className={fieldClass}
                >
                  <option value="mentor">Ментор</option>
                  <option value="admin">Админ</option>
                </select>
              </label>
              <label className="flex items-center gap-2.5 text-[14px]">
                <Switch
                  checked={interviewer}
                  onCheckedChange={changeInterviewer}
                  disabled={pending}
                  aria-label="Интервьюер"
                />
                Интервьюер
              </label>
            </div>

            {/* Permissions */}
            <div className="flex flex-col gap-2.5">
              <label className="flex items-center gap-2.5 text-[14px]">
                <Switch
                  checked={useOverride}
                  onCheckedChange={toggleOverride}
                  disabled={pending}
                  aria-label="Индивидуальные права"
                />
                Индивидуальные права
                {!useOverride && (
                  <span className="text-text-3 text-[13px]">— сейчас по пресету роли</span>
                )}
              </label>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {PERMISSIONS.map((perm) => (
                  <label
                    key={perm.key}
                    className="flex items-start gap-2.5 text-[13px]"
                    style={{ opacity: useOverride ? 1 : 0.7 }}
                  >
                    <input
                      type="checkbox"
                      className="accent-accent mt-0.5 size-4"
                      checked={effective.has(perm.key)}
                      disabled={!useOverride || pending}
                      onChange={(e) => togglePerm(perm.key, e.target.checked)}
                    />
                    <span>{perm.label}</span>
                  </label>
                ))}
              </div>
              {useOverride && (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={pending}
                    onClick={() =>
                      run(
                        setTeamPermissionsAction({
                          userId: member.id,
                          permissions: [...perms],
                        }),
                        "Права сохранены",
                      )
                    }
                  >
                    Сохранить права
                  </Button>
                </div>
              )}
            </div>

            {/* Access controls */}
            <div className="border-border flex flex-wrap items-center gap-2 border-t pt-4">
              {member.status !== "blocked" && (
                <ResetMemberPasswordDialog userId={member.id} email={member.email} />
              )}
              {member.status === "blocked" ? (
                <ActionButton
                  action={() => unblockTeamMemberAction(member.id)}
                  successMessage="Участник разблокирован"
                >
                  Разблокировать
                </ActionButton>
              ) : (
                <ActionButton
                  action={() => blockTeamMemberAction(member.id)}
                  className="text-danger"
                  successMessage="Участник заблокирован"
                  confirm={{
                    title: `Заблокировать ${member.name || member.email}?`,
                    description: "Все сессии завершатся мгновенно, вход станет невозможен.",
                    actionLabel: "Заблокировать",
                  }}
                >
                  Заблокировать
                </ActionButton>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
