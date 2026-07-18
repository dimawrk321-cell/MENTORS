import { describe, expect, it } from "vitest";
import {
  inviteEmail,
  newDeviceEmail,
  notificationEmail,
  passwordResetEmail,
} from "@/emails/templates";
import { renderNotification } from "@/lib/services/notifications";
import { sendEmail } from "@/lib/services/mail";

// Снапшоты рендера писем без отправки (spec DoD): темы/тела/ссылки на месте,
// нет плейсхолдеров; jsonTransport (без SMTP) не бросает.

describe("email templates render (без отправки)", () => {
  it("invite: имя, ссылка, без TODO/Lorem", () => {
    const email = inviteEmail("Аня", "https://mentors.example/invite/tok");
    expect(email.subject).toContain("приглашение");
    expect(email.html).toContain("Аня");
    expect(email.html).toContain("https://mentors.example/invite/tok");
    expect(email.text).toContain("https://mentors.example/invite/tok");
    expect(email.html).not.toMatch(/TODO|Lorem/);
  });

  it("password_reset и new_device", () => {
    expect(passwordResetEmail("https://x/reset/t").html).toContain("https://x/reset/t");
    expect(newDeviceEmail("Chrome · macOS").html).toContain("Chrome · macOS");
  });

  it("notificationEmail строится из type/title/body/url (абсолютная ссылка)", () => {
    const email = notificationEmail({
      type: "digest",
      title: "Повторения на сегодня",
      body: "Сегодня к повторению: 5 карточек (~2 мин)",
      url: "/trainer/session",
    });
    expect(email.subject).toBe("Повторения на сегодня");
    expect(email.html).toContain("5 карточек");
    expect(email.html).toContain("/trainer/session");
    expect(email.text).toContain("Сегодня к повторению");
  });

  it("email каждого доставляемого типа непустой", () => {
    for (const type of [
      "digest",
      "mock_24h",
      "mock_1h",
      "mock_booked",
      "mock_feedback",
      "mock_cancelled",
      "waitlist_offer",
      "access_14d",
      "access_3d",
      "access_0d",
    ] as const) {
      const email = notificationEmail({ type, title: "Заголовок", body: "Текст", url: "/x" });
      expect(email.html.length).toBeGreaterThan(80);
      expect(email.subject.length).toBeGreaterThan(0);
    }
  });

  it("рендер из renderNotification пригоден для письма", () => {
    const rendered = renderNotification("access_14d", {
      untilText: "5 августа",
      contact: "@mentor",
    });
    const email = notificationEmail({ type: "access_14d", ...rendered });
    expect(email.html).toContain("5 августа");
  });
});

describe("sendEmail dev-режим (jsonTransport)", () => {
  it("без SMTP не требует настроек и не бросает", async () => {
    await expect(
      sendEmail(
        "a@test.local",
        notificationEmail({
          type: "mock_1h",
          title: "Мок через час",
          body: "Скоро",
          url: "/mocks/x",
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
