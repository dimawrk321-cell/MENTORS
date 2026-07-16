"use client";

import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { openRecordingAction } from "@/lib/actions/library";
import { Watermark } from "@/components/features/watermark";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

// Recording viewer (spec 7.9). Two modes: an embedded iframe with the watermark
// overlay (pointer-events:none), or an «Открыть запись» link to Я.Диск. Both log
// the open exactly once (recording_views + recording.opened via the action).

/** iframe player with the always-present watermark layer over it (spec 5.7/7.9). */
export function RecordingEmbed({
  recordingId,
  embedUrl,
  watermarkEmail,
}: {
  recordingId: string;
  embedUrl: string;
  watermarkEmail: string;
}) {
  const logged = useRef(false);
  useEffect(() => {
    // Opening the page with an embed IS an open — log once (StrictMode-safe).
    if (logged.current) return;
    logged.current = true;
    void openRecordingAction(recordingId);
  }, [recordingId]);

  return (
    <div className="rounded-card border-border relative aspect-video w-full max-w-full overflow-hidden border">
      <iframe
        src={embedUrl}
        title="Запись собеседования"
        allow="fullscreen"
        allowFullScreen
        className="absolute inset-0 h-full w-full"
      />
      {/* Watermark над плеером — pointer-events:none, не мешает управлению. */}
      <Watermark email={watermarkEmail} />
    </div>
  );
}

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
