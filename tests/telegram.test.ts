import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/utils/crypto";
import { notify } from "@/lib/services/notifications";
import {
  createLinkCode,
  consumeLinkCode,
  getTelegramLinkStatus,
} from "@/lib/services/telegram/linking";
import {
  handleTelegramUpdate,
  handleTelegramCallback,
  TG_CALLBACK_UNLINK,
  TG_CALLBACK_REFRESH_TODAY,
  TELEGRAM_TILES,
} from "@/lib/services/telegram/commands";
import { signalOwner } from "@/lib/services/telegram/owner-signals";
import { runTelegramDispatchJob, type TelegramSend } from "@/worker/jobs/telegram-dispatch";
import { TelegramApiError } from "@/lib/services/telegram/api";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Walk 13.3 (spec 7.12/V1): Telegram bot — linking (one-time + TTL), notify
// channel routing + quiet hours/deadline, dispatch hygiene fuse + auto-unlink,
// commands without a link, and owner signals gated to the owner only.

const MSK = "Europe/Moscow";
const msk = (iso: string) => new Date(`${iso}:00+03:00`);

beforeEach(async () => {
  await resetDb();
});

/** Creates a user and links them to a Telegram chat via the real code flow. */
async function link(email: string, chatId: string) {
  const u = await createTestUser({ email, timezone: MSK });
  const { code } = await createLinkCode(testDb, u.id);
  await consumeLinkCode(testDb, { code, chatId });
  return u;
}

/** Fake Bot API sender — records sends, can simulate a blocked (403) chat. */
function fakeSender() {
  const calls: { chatId: string; text: string }[] = [];
  let blocked: string | null = null;
  const send: TelegramSend = async (chatId, spec) => {
    if (blocked === chatId) {
      throw new TelegramApiError(403, "Forbidden: bot was blocked by the user", "sendMessage");
    }
    calls.push({ chatId, text: spec.text });
  };
  return { calls, send, block: (chatId: string) => (blocked = chatId) };
}

describe("linking — одноразовость + TTL (block 1)", () => {
  it("валидный код связывает чат ровно один раз", async () => {
    const u = await createTestUser({ email: "l1@test.local" });
    const { code } = await createLinkCode(testDb, u.id);
    expect(await consumeLinkCode(testDb, { code, chatId: "111" })).toEqual({
      ok: true,
      userId: u.id,
    });
    // Повторное использование того же кода — отклонено.
    expect((await consumeLinkCode(testDb, { code, chatId: "111" })).ok).toBe(false);
    expect((await getTelegramLinkStatus(testDb, u.id)).linked).toBe(true);
  });

  it("просроченный код (> 10 мин) не связывает", async () => {
    const u = await createTestUser({ email: "l2@test.local" });
    const now = new Date("2026-07-15T12:00:00.000Z");
    const { code } = await createLinkCode(testDb, u.id, { now });
    const later = new Date(now.getTime() + 11 * 60 * 1000);
    expect((await consumeLinkCode(testDb, { code, chatId: "222", now: later })).ok).toBe(false);
    expect(await testDb.telegramLink.findUnique({ where: { userId: u.id } })).toBeNull();
  });

  it("новый код аннулирует прежние неиспользованные", async () => {
    const u = await createTestUser({ email: "l3@test.local" });
    const a = await createLinkCode(testDb, u.id);
    const b = await createLinkCode(testDb, u.id);
    expect((await consumeLinkCode(testDb, { code: a.code, chatId: "1" })).ok).toBe(false);
    expect((await consumeLinkCode(testDb, { code: b.code, chatId: "1" })).ok).toBe(true);
  });

  it("аудит привязки хранит chat_id только хешированным", async () => {
    const u = await createTestUser({ email: "l4@test.local" });
    const { code } = await createLinkCode(testDb, u.id);
    await consumeLinkCode(testDb, { code, chatId: "9998887" });
    const audit = await testDb.auditLog.findFirst({ where: { action: "telegram.linked" } });
    expect(JSON.stringify(audit)).not.toContain("9998887");
    expect((audit?.after as { chatIdHash: string }).chatIdHash).toBe(sha256Hex("9998887"));
  });
});

describe("notify — телеграм-канал (block 2)", () => {
  it("не подключён → ноль telegram (telegramPending=false)", async () => {
    const u = await createTestUser({ email: "n1@test.local", timezone: MSK });
    await notify(
      testDb,
      u.id,
      "mock_feedback",
      { bookingId: "b" },
      { now: msk("2026-07-15T12:00") },
    );
    const n = await testDb.notification.findFirst({ where: { userId: u.id } });
    expect(n?.telegramPending).toBe(false);
  });

  it("подключён + always-on тип → telegramPending=true", async () => {
    const u = await link("n2@test.local", "300");
    await notify(
      testDb,
      u.id,
      "mock_feedback",
      { bookingId: "b" },
      { now: msk("2026-07-15T12:00") },
    );
    const n = await testDb.notification.findFirst({ where: { userId: u.id } });
    expect(n).toMatchObject({ telegramPending: true, inApp: true });
  });

  it("подключён, но тип telegram недоступен (streak_risk) → telegramPending=false", async () => {
    const u = await link("n3@test.local", "301");
    await testDb.notificationPref.create({
      data: { userId: u.id, type: "streak_risk", inapp: true, email: false, telegram: true },
    });
    await notify(testDb, u.id, "streak_risk", { current: 4 }, { now: msk("2026-07-15T20:30") });
    const n = await testDb.notification.findFirst({ where: { userId: u.id, type: "streak_risk" } });
    expect(n?.telegramPending).toBe(false);
  });

  it("подключён, digest telegram выключен строкой prefs → telegramPending=false", async () => {
    const u = await link("n4@test.local", "302");
    await testDb.notificationPref.create({
      data: { userId: u.id, type: "digest", inapp: true, email: false, telegram: false },
    });
    await notify(
      testDb,
      u.id,
      "digest",
      { count: 3, estimateMin: 2 },
      { now: msk("2026-07-15T12:00") },
    );
    const n = await testDb.notification.findFirst({ where: { userId: u.id, type: "digest" } });
    expect(n).toMatchObject({ inApp: true, telegramPending: false });
  });
});

describe("тихие часы + дедлайн (block 2.1)", () => {
  it("несрочный тип в тихие часы: telegram откладывается до конца окна", async () => {
    const u = await link("q1@test.local", "400");
    await notify(
      testDb,
      u.id,
      "access_14d",
      { untilText: "5 августа", contact: "@mentor" },
      { now: msk("2026-07-15T23:00") },
    );
    const n = await testDb.notification.findFirst({ where: { userId: u.id, type: "access_14d" } });
    expect(n?.telegramPending).toBe(true);
    expect(n?.scheduledAt?.toISOString()).toBe("2026-07-16T05:00:00.000Z"); // 08:00 MSK
  });

  it("mock_1h в тихие часы: telegram отбрасывается, in-app остаётся", async () => {
    const u = await link("q2@test.local", "401");
    const now = msk("2026-07-15T03:00");
    await notify(
      testDb,
      u.id,
      "mock_1h",
      { bookingId: "b", whenText: "в 03:40" },
      { now, emailDeadline: msk("2026-07-15T03:40") },
    );
    const n = await testDb.notification.findFirst({ where: { userId: u.id, type: "mock_1h" } });
    expect(n).toMatchObject({ inApp: true, telegramPending: false, emailPending: false });
  });
});

describe("telegramDispatch — доставка + гигиена (block 2.3 / 5)", () => {
  it("без токена и без sender — no-op (disabled)", async () => {
    const u = await link("d0@test.local", "499");
    await notify(testDb, u.id, "mock_feedback", { bookingId: "b" }, { now: new Date() });
    expect(await runTelegramDispatchJob(testDb, new Date())).toMatchObject({ disabled: true });
  });

  it("отправляет подключённому и проставляет telegram_sent_at", async () => {
    const u = await link("d1@test.local", "500");
    const now = new Date("2026-07-15T12:00:00.000Z");
    await notify(testDb, u.id, "mock_feedback", { bookingId: "b1" }, { now });
    const s = fakeSender();
    expect(await runTelegramDispatchJob(testDb, now, s.send)).toMatchObject({ sent: 1 });
    expect(s.calls[0]!.chatId).toBe("500");
    const n = await testDb.notification.findFirst({ where: { userId: u.id } });
    expect(n?.telegramPending).toBe(false);
    expect(n?.telegramSentAt).not.toBeNull();
  });

  it("просроченный дедлайн пропускается (не отправляется)", async () => {
    const u = await link("d2@test.local", "501");
    const t0 = new Date("2026-07-15T12:00:00.000Z"); // 15:00 MSK — не тихие часы
    await notify(
      testDb,
      u.id,
      "mock_1h",
      { bookingId: "b", whenText: "в 15:30" },
      { now: t0, emailDeadline: new Date(t0.getTime() + 30 * 60 * 1000) },
    );
    const dispatchNow = new Date(t0.getTime() + 60 * 60 * 1000);
    const s = fakeSender();
    expect(await runTelegramDispatchJob(testDb, dispatchNow, s.send)).toMatchObject({ skipped: 1 });
    expect(s.calls).toHaveLength(0);
  });

  it("предохранитель: digest подавляется при недавней отправке (< 1ч)", async () => {
    const u = await link("d3@test.local", "502");
    const now = new Date("2026-07-15T12:00:00.000Z");
    // Уже отправленное 10 минут назад сообщение — трогает окно предохранителя.
    await testDb.notification.create({
      data: {
        userId: u.id,
        type: "mock_feedback",
        title: "x",
        inApp: true,
        telegramSentAt: new Date(now.getTime() - 10 * 60 * 1000),
      },
    });
    await notify(testDb, u.id, "digest", { count: 3, estimateMin: 2 }, { now });
    const s = fakeSender();
    expect(await runTelegramDispatchJob(testDb, now, s.send)).toMatchObject({
      sent: 0,
      skipped: 1,
    });
    const n = await testDb.notification.findFirst({ where: { userId: u.id, type: "digest" } });
    expect(n).toMatchObject({ telegramPending: false, inApp: true }); // dropped from TG, bell keeps it
  });

  it("mock_1h освобождён от предохранителя (always-exempt)", async () => {
    const u = await link("d4@test.local", "503");
    const now = new Date("2026-07-15T12:00:00.000Z");
    await testDb.notification.create({
      data: {
        userId: u.id,
        type: "digest",
        title: "x",
        inApp: true,
        telegramSentAt: new Date(now.getTime() - 10 * 60 * 1000),
      },
    });
    await notify(
      testDb,
      u.id,
      "mock_1h",
      { bookingId: "b", whenText: "в 15:30" },
      { now, emailDeadline: new Date(now.getTime() + 60 * 60 * 1000) },
    );
    const s = fakeSender();
    expect(await runTelegramDispatchJob(testDb, now, s.send)).toMatchObject({ sent: 1 });
  });

  it("заблокированный чат (403) → авто-отвязка + inapp «Telegram отключён»", async () => {
    const u = await link("d5@test.local", "505");
    const now = new Date("2026-07-15T12:00:00.000Z");
    await notify(testDb, u.id, "mock_feedback", { bookingId: "b" }, { now });
    const s = fakeSender();
    s.block("505");
    expect(await runTelegramDispatchJob(testDb, now, s.send)).toMatchObject({
      unlinked: 1,
      sent: 0,
    });
    expect(await testDb.telegramLink.findUnique({ where: { userId: u.id } })).toBeNull();
    const notice = await testDb.notification.findFirst({
      where: { userId: u.id, type: "telegram_unlinked" },
    });
    expect(notice?.inApp).toBe(true);
    const orig = await testDb.notification.findFirst({
      where: { userId: u.id, type: "mock_feedback" },
    });
    expect(orig?.telegramPending).toBe(false);
    expect(
      await testDb.auditLog.findFirst({ where: { action: "telegram.unlinked" } }),
    ).not.toBeNull();
  });
});

describe("команды бота (block 3)", () => {
  it("непривязанный чат — одно вежливое приглашение", async () => {
    const replies = await handleTelegramUpdate(testDb, { chatId: "600", text: "/today" });
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain("профиле");
  });

  it("/start <код> связывает и сразу показывает карточку дня", async () => {
    const u = await createTestUser({ email: "c1@test.local", timezone: MSK });
    const { code } = await createLinkCode(testDb, u.id);
    const replies = await handleTelegramUpdate(testDb, { chatId: "601", text: `/start ${code}` });
    expect(replies.length).toBeGreaterThanOrEqual(2);
    expect(replies[0]!.text).toContain("подключён");
    expect(replies[1]!.text).toContain("Сегодня");
    expect((await getTelegramLinkStatus(testDb, u.id)).linked).toBe(true);
  });

  it("/help и неизвестная команда у привязанного чата", async () => {
    await link("c2@test.local", "602");
    const help = await handleTelegramUpdate(testDb, { chatId: "602", text: "/help" });
    expect(help[0]!.text).toContain("/today");
    const unknown = await handleTelegramUpdate(testDb, { chatId: "602", text: "/wat" });
    expect(unknown[0]!.text).toContain("/help");
  });

  it("/stop подтверждает, callback отвязывает", async () => {
    const u = await link("c3@test.local", "603");
    const stop = await handleTelegramUpdate(testDb, { chatId: "603", text: "/stop" });
    const hasUnlinkButton = stop[0]!.buttons?.some(
      (b) => "callbackData" in b && b.callbackData === TG_CALLBACK_UNLINK,
    );
    expect(hasUnlinkButton).toBe(true);
    await handleTelegramCallback(testDb, { chatId: "603", data: TG_CALLBACK_UNLINK });
    expect(await testDb.telegramLink.findUnique({ where: { userId: u.id } })).toBeNull();
  });
});

describe("reply-клавиатура и навигация (walk 13.5 block 3)", () => {
  it("тап плашки шлётся текстом и мапится на тот же хендлер, что команда", async () => {
    await link("k1@test.local", "800");
    const streak = await handleTelegramUpdate(testDb, {
      chatId: "800",
      text: TELEGRAM_TILES.streak,
    });
    expect(streak[0]!.text).toContain("Текущая"); // buildStreak
    const today = await handleTelegramUpdate(testDb, {
      chatId: "800",
      text: TELEGRAM_TILES.today,
    });
    expect(today[0]!.text).toContain("Сегодня"); // buildTodayCard
  });

  it("команды продолжают работать параллельно плашкам", async () => {
    await link("k2@test.local", "801");
    const streak = await handleTelegramUpdate(testDb, { chatId: "801", text: "/streak" });
    expect(streak[0]!.text).toContain("Текущая");
  });

  it("клавиатура прикладывается к ответу /start (первое сообщение без inline-кнопок)", async () => {
    const u = await createTestUser({ email: "k3@test.local", timezone: MSK });
    const { code } = await createLinkCode(testDb, u.id);
    const replies = await handleTelegramUpdate(testDb, { chatId: "802", text: `/start ${code}` });
    expect(replies.some((r) => r.replyKeyboard)).toBe(true);
    // Клавиатура — на подтверждении (без inline), не на карточке дня (с inline).
    expect(replies[0]!.replyKeyboard).toBe(true);
    expect(replies[0]!.buttons ?? []).toHaveLength(0);
  });

  it("клавиатура прикладывается к inline-free ответу (/streak)", async () => {
    await link("k4@test.local", "803");
    const streak = await handleTelegramUpdate(testDb, { chatId: "803", text: "/streak" });
    expect(streak[0]!.replyKeyboard).toBe(true);
  });

  it("непривязанный чат не получает плашек", async () => {
    const replies = await handleTelegramUpdate(testDb, { chatId: "804", text: "/today" });
    expect(replies.every((r) => !r.replyKeyboard)).toBe(true);
  });

  it("карточка дня несёт кнопку «Обновить»", async () => {
    await link("k5@test.local", "805");
    const today = await handleTelegramUpdate(testDb, { chatId: "805", text: "/today" });
    const hasRefresh = today[0]!.buttons?.some(
      (b) => "callbackData" in b && b.callbackData === TG_CALLBACK_REFRESH_TODAY,
    );
    expect(hasRefresh).toBe(true);
  });

  it("«Обновить» перерисовывает карточку дня", async () => {
    await link("k6@test.local", "806");
    const replies = await handleTelegramCallback(testDb, {
      chatId: "806",
      data: TG_CALLBACK_REFRESH_TODAY,
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain("Сегодня");
    const hasRefresh = replies[0]!.buttons?.some(
      (b) => "callbackData" in b && b.callbackData === TG_CALLBACK_REFRESH_TODAY,
    );
    expect(hasRefresh).toBe(true);
  });
});

describe("owner-сигналы (block 4)", () => {
  it("сигнал уходит только привязанному владельцу", async () => {
    const owner = await createTestUser({ email: "o1@test.local", role: "owner" });
    // Не привязан → сигнала нет.
    expect(
      await signalOwner(testDb, { kind: "no_show", studentName: "Вася", whenText: "вчера" }),
    ).toBe(false);
    const { code } = await createLinkCode(testDb, owner.id);
    await consumeLinkCode(testDb, { code, chatId: "700" });
    expect(
      await signalOwner(testDb, { kind: "no_show", studentName: "Вася", whenText: "вчера" }),
    ).toBe(true);
    const row = await testDb.notification.findFirst({
      where: { userId: owner.id, type: "owner_no_show" },
    });
    expect(row).toMatchObject({ telegramPending: true, inApp: false });
  });

  it("выключенный тумблер — сигнал не уходит", async () => {
    const owner = await createTestUser({ email: "o2@test.local", role: "owner" });
    const { code } = await createLinkCode(testDb, owner.id);
    await consumeLinkCode(testDb, { code, chatId: "701" });
    await testDb.appSetting.create({ data: { key: "owner_signals", value: { no_show: false } } });
    expect(await signalOwner(testDb, { kind: "no_show", studentName: "x", whenText: "y" })).toBe(
      false,
    );
  });

  it("сигнал не создаётся, если owner отсутствует (обычный пользователь)", async () => {
    const student = await link("o3@test.local", "702");
    expect(await signalOwner(testDb, { kind: "no_show", studentName: "x", whenText: "y" })).toBe(
      false,
    );
    expect(
      await testDb.notification.count({
        where: { userId: student.id, type: { startsWith: "owner_" } },
      }),
    ).toBe(0);
  });
});
