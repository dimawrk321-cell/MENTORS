import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileTabs } from "@/components/features/profile-tabs";

describe("вкладки профиля", () => {
  it("не рисуют нативную полосу, сохраняя горизонтальную прокрутку", () => {
    const html = renderToStaticMarkup(
      <ProfileTabs
        defaultTab="overview"
        overview={<div>Обзор профиля</div>}
        xp={<div>XP</div>}
        settings={<div>Настройки профиля</div>}
      />,
    );

    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("overflow-y-hidden");
    expect(html).toContain("scrollbar-width:none");
    expect(html).toContain("webkit-scrollbar");
  });
});
