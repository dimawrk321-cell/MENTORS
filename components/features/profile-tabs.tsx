"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Вкладки профиля (заход C.8 «Профиль по референсу v2»).
//
// Содержимое приходит готовыми серверными узлами: данные читает страница, а этот
// компонент только переключает. Значение вкладки едет в адресе (`?tab=`), чтобы
// ссылка и перезагрузка возвращали ученика туда же; переключение при этом —
// `history.replaceState`, без похода на сервер (данные всех трёх вкладок уже
// пришли одним рендером).
//
// Старая ссылка `/profile#xp` из блока дневной цели остаётся рабочей: якорь
// читается на монтировании и открывает ту же вкладку.

export const PROFILE_TABS = ["overview", "xp", "settings"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function resolveProfileTab(value: string | undefined): ProfileTab {
  return PROFILE_TABS.includes(value as ProfileTab) ? (value as ProfileTab) : "overview";
}

export function ProfileTabs({
  defaultTab,
  overview,
  xp,
  settings,
}: {
  defaultTab: ProfileTab;
  overview: ReactNode;
  xp: ReactNode;
  settings: ReactNode;
}) {
  const [tab, setTab] = useState<ProfileTab>(defaultTab);

  useEffect(() => {
    if (window.location.hash === "#xp") setTab("xp");
  }, []);

  const change = (next: string) => {
    const value = resolveProfileTab(next);
    setTab(value);
    const url = new URL(window.location.href);
    url.hash = "";
    if (value === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url.toString());
  };

  return (
    <Tabs value={tab} onValueChange={change}>
      <TabsList
        aria-label="Разделы профиля"
        className="[scrollbar-width:none] overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden"
      >
        <TabsTrigger value="overview">Обзор</TabsTrigger>
        <TabsTrigger value="xp">XP, цель и серия</TabsTrigger>
        <TabsTrigger value="settings">Настройки</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">{overview}</TabsContent>
      <TabsContent value="xp">{xp}</TabsContent>
      <TabsContent value="settings">{settings}</TabsContent>
    </Tabs>
  );
}
