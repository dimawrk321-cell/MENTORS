"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createGuide,
  deleteGuide,
  logGuideOpen,
  saveGuideContent,
  setGuideStatus,
  toggleBookmark,
  updateGuideMeta,
} from "@/lib/services/guides";
import {
  ActionError,
  assertActiveAccess,
  assertNotImpersonating,
  parseInput,
  requireActionRole,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  createGuideSchema,
  guideMetaSchema,
  saveGuideContentSchema,
  toggleBookmarkSchema,
} from "@/lib/utils/validation";

// Guides actions (spec 7.10). Students read/bookmark; mentor+ author.

// --- Student ---

/** Logs guide.opened (spec 7.13). Skipped under impersonation (read-only). */
export async function openGuideAction(guideId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    assertActiveAccess(auth);
    const { guideId: id } = parseInput(z.object({ guideId: z.string().min(1) }), { guideId });
    if (!auth.impersonated) {
      await logGuideOpen(prisma, { userId: auth.user.id, guideId: id });
    }
    return undefined;
  });
}

export async function toggleBookmarkAction(
  guideId: string,
): Promise<ActionResult<{ bookmarked: boolean }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const { guideId: id } = parseInput(toggleBookmarkSchema, { guideId });
    const res = await toggleBookmark(prisma, { userId: auth.user.id, guideId: id });
    if (!res.ok) throw new ActionError(res.code, "Гайд не найден");
    return { bookmarked: res.bookmarked };
  });
}

// --- Admin (mentor+ — spec 2: создавать/редактировать гайды) ---

function revalidateGuides(slug?: string, guideId?: string): void {
  revalidatePath("/admin/content/guides");
  revalidatePath("/guides");
  if (slug) revalidatePath(`/guides/${slug}`);
  if (guideId) revalidatePath(`/admin/content/guides/${guideId}`);
}

function failGuide(code: "not_found" | "slug_taken" | "not_draft"): never {
  const messages: Record<typeof code, string> = {
    not_found: "Гайд не найден",
    slug_taken: "Такой slug уже занят",
    not_draft: "Удалять можно только черновики — сначала сними с публикации",
  };
  throw new ActionError(code, messages[code]);
}

export async function createGuideAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(createGuideSchema, input);
    const created = await createGuide(prisma, {
      actorId: auth.user.id,
      section: parsed.section,
      title: parsed.title,
    });
    revalidateGuides();
    return created;
  });
}

export async function saveGuideContentAction(
  guideId: string,
  contentMd: string,
): Promise<ActionResult<{ readingMinutes: number }>> {
  return runAction(async () => {
    await requireActionRole("mentor");
    const parsed = parseInput(saveGuideContentSchema, { guideId, contentMd });
    const res = await saveGuideContent(prisma, parsed);
    if (!res.ok) failGuide(res.code);
    return { readingMinutes: res.readingMinutes ?? 1 };
  });
}

export async function updateGuideMetaAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(guideMetaSchema, input);
    const res = await updateGuideMeta(prisma, { actorId: auth.user.id, ...parsed });
    if (!res.ok) failGuide(res.code);
    revalidateGuides(parsed.slug, parsed.guideId);
    return undefined;
  });
}

export async function setGuideStatusAction(
  guideId: string,
  status: "draft" | "published",
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(
      z.object({ guideId: z.string().min(1), status: z.enum(["draft", "published"]) }),
      { guideId, status },
    );
    const res = await setGuideStatus(prisma, {
      actorId: auth.user.id,
      guideId: parsed.guideId,
      status: parsed.status,
    });
    if (!res.ok) failGuide(res.code);
    revalidateGuides(undefined, guideId);
    return undefined;
  });
}

export async function deleteGuideAction(guideId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(z.object({ guideId: z.string().min(1) }), { guideId });
    const res = await deleteGuide(prisma, { actorId: auth.user.id, guideId: parsed.guideId });
    if (!res.ok) failGuide(res.code);
    revalidateGuides();
    return undefined;
  });
}
