import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "./helpers/db";
import { applyLevelUp } from "@/lib/services/level-progression";

// D7 (spec 13.1): milestone freeze bonuses (5/10/15/20 → +1, cap 3 from level 10)
// + «Новый титул» notification, idempotent via the xp_events marker.

const DAY = new Date("2026-07-22");

async function makeStudent(freezes = 0) {
  const user = await testDb.user.create({
    data: { email: `s${Math.random()}@x.io`, name: "S", role: "student", status: "active", avatarColor: 0 },
  });
  if (freezes > 0) {
    await testDb.streak.create({ data: { userId: user.id, freezes } });
  }
  return user;
}

describe("applyLevelUp (spec 13.1/D7)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("grants +1 freeze crossing level 5 and is idempotent on replay", async () => {
    const s = await makeStudent(0);
    const r1 = await applyLevelUp(testDb, { userId: s.id, before: 4, after: 5, day: DAY });
    expect(r1.freezesGranted).toBe(1);
    expect((await testDb.streak.findUniqueOrThrow({ where: { userId: s.id } })).freezes).toBe(1);
    // The marker exists → a replay grants nothing more.
    const r2 = await applyLevelUp(testDb, { userId: s.id, before: 4, after: 5, day: DAY });
    expect(r2.freezesGranted).toBe(0);
    expect((await testDb.streak.findUniqueOrThrow({ where: { userId: s.id } })).freezes).toBe(1);
    expect(
      await testDb.xpEvent.count({ where: { userId: s.id, type: "level.freeze_bonus" } }),
    ).toBe(1);
  });

  it("cap is 3 from level 10 (a level-10 bonus can push 2 → 3)", async () => {
    const s = await makeStudent(2);
    const r = await applyLevelUp(testDb, { userId: s.id, before: 9, after: 10, day: DAY });
    expect(r.freezesGranted).toBe(1);
    expect((await testDb.streak.findUniqueOrThrow({ where: { userId: s.id } })).freezes).toBe(3);
  });

  it("respects cap 2 below level 10 (no grant when already at 2)", async () => {
    const s = await makeStudent(2);
    const r = await applyLevelUp(testDb, { userId: s.id, before: 4, after: 5, day: DAY });
    expect(r.freezesGranted).toBe(0);
    expect((await testDb.streak.findUniqueOrThrow({ where: { userId: s.id } })).freezes).toBe(2);
    // The milestone is still marked processed (not retried later).
    expect(
      await testDb.xpEvent.count({ where: { userId: s.id, type: "level.freeze_bonus" } }),
    ).toBe(1);
  });

  it("grants multiple milestones crossed in one jump", async () => {
    const s = await makeStudent(0);
    // 4 → 11 crosses both 5 and 10.
    const r = await applyLevelUp(testDb, { userId: s.id, before: 4, after: 11, day: DAY });
    expect(r.freezesGranted).toBe(2);
  });

  it("sends «Новый титул» when the title changes, not otherwise", async () => {
    const s = await makeStudent(0);
    // 4 (Джун) → 5 (Оверфиттер): title changes.
    const changed = await applyLevelUp(testDb, { userId: s.id, before: 4, after: 5, day: DAY });
    expect(changed.newTitle).not.toBeNull();
    expect(await testDb.notification.count({ where: { userId: s.id, type: "level_title" } })).toBe(1);

    // 5 → 6 stays «Оверфиттер» (minLevel 5, next is 7): no new title.
    const same = await applyLevelUp(testDb, { userId: s.id, before: 5, after: 6, day: DAY });
    expect(same.newTitle).toBeNull();
    expect(await testDb.notification.count({ where: { userId: s.id, type: "level_title" } })).toBe(1);
  });
});
