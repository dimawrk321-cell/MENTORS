"use client";

import { useRef } from "react";
import { ExternalLink } from "lucide-react";
import { openRecordingAction } from "@/lib/actions/library";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

// Recording viewer (spec 7.9). Один путь: «Открыть запись» в новой вкладке;
// открытие логируется ровно один раз (recording_views + recording.opened через
// действие).
//
// Заход C.5: вторая ветка — iframe-плеер с водяным знаком поверх — снята. Она
// не могла сработать: встраивание запрещает сам Я.Диск (`frame-ancestors` его
// публичной страницы разрешает только домены Вебвизора), и за всё время ни у
// одной записи `embed_url` не был заполнен. Водяной знак над плеером — не
// отменённое, а ОТЛОЖЕННОЕ требование 5.7: он вернётся вместе с переездом на
// видеохостинг с подписанными URL (V1 раздела 16). На чужой вкладке нашего слоя
// не бывает, накрывать нечего.

/** «Открыть запись» → new tab (spec 7.9); the open is logged on click. */
export function RecordingOpenLink({ recordingId, url }: { recordingId: string; url: string }) {
  const logged = useRef(false);

  function onOpen(): void {
    if (logged.current) return;
    logged.current = true;
    void openRecordingAction(recordingId).then((res) => {
      if (res && !res.ok) toast({ title: res.error.message, variant: "danger" });
    });
  }

  return (
    <Button asChild>
      {/* Real anchor so the new tab opens on the user gesture (no popup block). */}
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={onOpen}>
        <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
        Открыть запись
      </a>
    </Button>
  );
}
