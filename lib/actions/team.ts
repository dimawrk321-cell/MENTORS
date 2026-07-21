"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { buildCredentialMessage } from "@/lib/services/access";
import {
  blockTeamMember,
  createTeamMember,
  resetTeamMemberPassword,
  setTeamMemberInterviewer,
  setTeamMemberPermissions,
  setTeamMemberRole,
  unblockTeamMember,
  type TeamMemberActionResult,
} from "@/lib/services/team";
import {
  ActionError,
  parseInput,
  requireActionOwner,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  createTeamMemberSchema,
  teamInterviewerSchema,
  teamPermissionsSchema,
  teamRoleSchema,
} from "@/lib/utils/validation";

// Team management (spec 12.4/B). ALL actions are owner-only (requireActionOwner) —
// roles, permissions, is_interviewer and staff blocks/resets are the owner's alone.

function revalidateTeam(): void {
  revalidatePath("/admin/team");
}

/** Maps the shared team-mutation result union to a user-facing ActionError. */
function throwOnMemberError(res: TeamMemberActionResult): void {
  if (res.ok) return;
  const messages: Record<typeof res.code, string> = {
    not_found: "Участник не найден",
    is_owner: "Владельца изменить нельзя",
    wrong_status: "Статус участника уже такой",
  };
  throw new ActionError(res.code, messages[res.code]);
}

export interface TeamMemberCreated {
  userId: string;
  email: string;
  tempPassword: string;
  message: string;
}

export type TeamMemberFormState = ActionResult<TeamMemberCreated> | null;

/** «Добавить участника» (walk 12.4/B4): creates staff with a temp password. */
export async function createTeamMemberAction(
  _prev: TeamMemberFormState,
  formData: FormData,
): Promise<TeamMemberFormState> {
  return runAction<TeamMemberCreated>(async () => {
    const auth = await requireActionOwner();
    const input = parseInput(createTeamMemberSchema, {
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
      isInterviewer: formData.get("isInterviewer") === "on",
    });
    const res = await createTeamMember(prisma, {
      actorId: auth.user.id,
      email: input.email,
      name: input.name,
      role: input.role,
      isInterviewer: input.isInterviewer,
    });
    if (!res.ok) {
      throw new ActionError(res.code, "Пользователь с таким email уже существует");
    }
    revalidateTeam();
    return {
      userId: res.userId,
      email: input.email,
      tempPassword: res.tempPassword,
      message: buildCredentialMessage(input.email, res.tempPassword),
    };
  });
}

export async function setTeamRoleAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionOwner();
    const parsed = parseInput(teamRoleSchema, input);
    throwOnMemberError(
      await setTeamMemberRole(prisma, {
        actorId: auth.user.id,
        userId: parsed.userId,
        role: parsed.role,
      }),
    );
    revalidateTeam();
    return undefined;
  });
}

export async function setTeamPermissionsAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionOwner();
    const parsed = parseInput(teamPermissionsSchema, input);
    throwOnMemberError(
      await setTeamMemberPermissions(prisma, {
        actorId: auth.user.id,
        userId: parsed.userId,
        permissions: parsed.permissions,
      }),
    );
    revalidateTeam();
    return undefined;
  });
}

export async function setTeamInterviewerAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionOwner();
    const parsed = parseInput(teamInterviewerSchema, input);
    throwOnMemberError(
      await setTeamMemberInterviewer(prisma, {
        actorId: auth.user.id,
        userId: parsed.userId,
        isInterviewer: parsed.isInterviewer,
      }),
    );
    revalidateTeam();
    return undefined;
  });
}

export async function blockTeamMemberAction(userId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionOwner();
    throwOnMemberError(await blockTeamMember(prisma, { actorId: auth.user.id, userId }));
    revalidateTeam();
    return undefined;
  });
}

export async function unblockTeamMemberAction(userId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionOwner();
    throwOnMemberError(await unblockTeamMember(prisma, { actorId: auth.user.id, userId }));
    revalidateTeam();
    return undefined;
  });
}

export async function resetTeamMemberPasswordAction(
  userId: string,
): Promise<ActionResult<{ tempPassword: string; message: string }>> {
  return runAction(async () => {
    const auth = await requireActionOwner();
    const res = await resetTeamMemberPassword(prisma, { actorId: auth.user.id, userId });
    if (!res.ok) {
      const messages: Record<typeof res.code, string> = {
        not_found: "Участник не найден",
        is_owner: "Владельца изменить нельзя",
        not_eligible: "Сброс доступен участнику с паролем и не заблокированному",
      };
      throw new ActionError(res.code, messages[res.code]);
    }
    revalidateTeam();
    return {
      tempPassword: res.tempPassword,
      message: buildCredentialMessage(res.email, res.tempPassword),
    };
  });
}
