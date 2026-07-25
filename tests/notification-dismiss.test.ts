import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissNotifications,
  getRecentNotifications,
  getRecentSentNotifications,
  getUnreadCount,
} from "@/lib/services/notifications";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Walk 13.4/4.4: dismiss hides from the bell + unread count but the admin tab keeps it.

async function makeNotif(userId: string, title: string, opts: { read?: boolean } = {}) {
  return testDb.notification.create({
    data: {
      userId,
      type: "digest",
      title,
      inApp: true,
      readAt: opts.read ? new Date() : null,
    },
  });
}

describe("notification dismiss (spec 13.4/4.4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("крестик прячет из колокольчика и из счётчика; админ-вкладка видит скрытое", async () => {
    const u = await createTestUser({ email: "s@test.local" });
    const a = await makeNotif(u.id, "A");
    const b = await makeNotif(u.id, "B");
    expect(await getUnreadCount(testDb, u.id)).toBe(2);

    const n = await dismissNotifications(testDb, u.id, { ids: [a.id] });
    expect(n).toBe(1);

    // Bell: only B remains; unread count honest.
    const bell = await getRecentNotifications(testDb, u.id);
    expect(bell.items.map((i) => i.id)).toEqual([b.id]);
    expect(bell.unread).toBe(1);
    expect(await getUnreadCount(testDb, u.id)).toBe(1);

    // The dismissed row is read + dismissed.
    const fresh = await testDb.notification.findUniqueOrThrow({ where: { id: a.id } });
    expect(fresh.dismissedAt).not.toBeNull();
    expect(fresh.readAt).not.toBeNull();

    // Admin «Уведомления» tab still sees it, flagged dismissed.
    const sent = await getRecentSentNotifications(testDb, u.id);
    expect(sent).toHaveLength(2);
    expect(sent.find((s) => s.id === a.id)!.dismissedAt).not.toBeNull();
    expect(sent.find((s) => s.id === b.id)!.dismissedAt).toBeNull();
  });

  it("«Очистить» скрывает всё; счётчик 0; повторный вызов идемпотентен", async () => {
    const u = await createTestUser({ email: "s@test.local" });
    await makeNotif(u.id, "A");
    await makeNotif(u.id, "B", { read: true });
    await makeNotif(u.id, "C");

    const cleared = await dismissNotifications(testDb, u.id, { all: true });
    expect(cleared).toBe(3);
    expect(await getUnreadCount(testDb, u.id)).toBe(0);
    expect((await getRecentNotifications(testDb, u.id)).items).toHaveLength(0);
    // Idempotent — nothing left to dismiss.
    expect(await dismissNotifications(testDb, u.id, { all: true })).toBe(0);
    // Admin tab still shows all three.
    expect(await getRecentSentNotifications(testDb, u.id)).toHaveLength(3);
  });

  it("dismiss не трогает чужие уведомления", async () => {
    const u1 = await createTestUser({ email: "a@test.local" });
    const u2 = await createTestUser({ email: "b@test.local" });
    await makeNotif(u1.id, "mine");
    const other = await makeNotif(u2.id, "theirs");

    await dismissNotifications(testDb, u1.id, { all: true });

    expect(
      (await testDb.notification.findUniqueOrThrow({ where: { id: other.id } })).dismissedAt,
    ).toBeNull();
  });
});
